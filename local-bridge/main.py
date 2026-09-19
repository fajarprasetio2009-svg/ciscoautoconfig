"""Local HTTP bridge for Cisco Auto Configurator.

The bridge never types on startup. Keyboard automation only begins after a
connected client explicitly POSTs /commands.
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time
import uuid
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    import pyautogui
    import pygetwindow
except ImportError:  # Allows the API to be inspected before installing requirements.
    pyautogui = None
    pygetwindow = None

HOST = "127.0.0.1"
PORT = 5000
CONNECTION_SERVICE = os.getenv("CONNECTION_SERVICE_URL", "http://127.0.0.1:8787").rstrip("/")
COMMAND_DELAY_SECONDS = 0.35
PACKET_TRACER_TITLES = ("Cisco Packet Tracer", "Packet Tracer")


class BridgeState:
    def __init__(self) -> None:
        self.connected = False
        self.status = "OFFLINE"
        self.device_code = self._new_device_code()
        self.commands: list[str] = []
        self.completed: list[str] = []
        self.current_command = ""
        self.progress = 0
        self.job_id: str | None = None
        self.cancel_requested = False
        self.lock = threading.Lock()
        self.queue: queue.Queue[tuple[str, list[str]]] = queue.Queue()
        self.worker = threading.Thread(target=self._worker, daemon=True)
        self.worker.start()
        self.remote_worker = threading.Thread(target=self._remote_worker, daemon=True)
        self.remote_worker.start()

    @staticmethod
    def _new_device_code() -> str:
        token = uuid.uuid4().hex.upper()
        return f"CCA-{token[:4]}-{token[4:8]}"

    def connect(self) -> dict[str, Any]:
        with self.lock:
            self.connected = True
            self.status = "READY"
            self.cancel_requested = False
        return self.snapshot()

    def register_remote_device(self) -> None:
        try:
            payload = self._service_request("/api/device/register", {"deviceCode": self.device_code})
            with self.lock:
                self.service_token = payload["deviceToken"]
        except Exception as error:
            print(f"[bridge] connection service unavailable: {error}")

    def _service_request(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(f"{CONNECTION_SERVICE}{path}", data=data, headers={"Content-Type": "application/json"} if data else {})
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.loads(response.read())

    def _remote_worker(self) -> None:
        self.service_token = ""
        while True:
            try:
                if not self.connected:
                    time.sleep(0.7)
                    continue
                if not self.service_token:
                    self.register_remote_device()
                if self.service_token:
                    job_response = self._service_request(f"/api/device/next?deviceToken={self.service_token}")
                    job = job_response.get("job")
                    if job:
                        self.send_commands(job["commands"])
                        self._run_service_job(job["id"])
                    else:
                        self._service_request("/api/device/heartbeat", {"deviceCode": self.device_code, "deviceToken": self.service_token, "status": self.status, "busy": self.status == "PROCESSING"})
            except Exception:
                self.service_token = ""
            time.sleep(0.7)

    def _run_service_job(self, job_id: str) -> None:
        while True:
            snapshot = self.snapshot()
            control = self._service_request(f"/api/device/control?deviceToken={self.service_token}&jobId={job_id}")
            if control.get("cancelRequested"):
                self.cancel()
            self._service_request("/api/device/job-status", {"deviceToken": self.service_token, "jobId": job_id, "status": snapshot["status"], "progress": snapshot["progress"], "currentCommand": snapshot["current_command"], "completed": snapshot["completed"]})
            if snapshot["status"] != "PROCESSING":
                return
            time.sleep(0.35)

    def disconnect(self) -> dict[str, Any]:
        self.cancel()
        with self.lock:
            self.connected = False
            self.status = "OFFLINE"
        return self.snapshot()

    def get_status(self) -> dict[str, Any]:
        return self.snapshot()

    def regenerate_code(self) -> dict[str, Any]:
        with self.lock:
            self.device_code = self._new_device_code()
        return self.snapshot()

    def send_commands(self, commands: list[str]) -> dict[str, Any]:
        if not commands or not all(isinstance(command, str) and command.strip() for command in commands):
            raise ValueError("commands must be a non-empty array of strings")
        with self.lock:
            if not self.connected:
                raise ConnectionError("Bridge is not connected")
            if self.status == "PROCESSING":
                raise RuntimeError("A command job is already processing")
            self.commands = commands[:]
            self.completed = []
            self.current_command = ""
            self.progress = 0
            self.cancel_requested = False
            self.job_id = uuid.uuid4().hex
            job_id = self.job_id
            self.queue.put((job_id, commands[:]))
            self.status = "PROCESSING"
        return self.snapshot()

    def send_command(self, command: str) -> dict[str, Any]:
        return self.send_commands([command])

    def cancel(self) -> dict[str, Any]:
        with self.lock:
            if self.status == "PROCESSING":
                self.cancel_requested = True
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "connected": self.connected,
                "status": self.status,
                "device_code": self.device_code,
                "job_id": self.job_id,
                "commands": self.commands,
                "completed": self.completed,
                "current_command": self.current_command,
                "progress": self.progress,
            }

    def _worker(self) -> None:
        while True:
            job_id, commands = self.queue.get()
            try:
                for index, command in enumerate(commands):
                    with self.lock:
                        if self.cancel_requested or not self.connected:
                            self.status = "OFFLINE" if not self.connected else "FAILED"
                            self.current_command = ""
                            break
                        self.current_command = command
                    packet_tracer = self._packet_tracer_window()
                    if packet_tracer is None:
                        raise RuntimeError("Cisco Packet Tracer CLI window was not found")
                    if pyautogui is None:
                        raise RuntimeError("PyAutoGUI is not installed")
                    packet_tracer.activate()
                    pyautogui.write(command, interval=0.01)
                    pyautogui.press("enter")
                    time.sleep(COMMAND_DELAY_SECONDS)
                    with self.lock:
                        self.completed.append(command)
                        self.progress = int(((index + 1) / len(commands)) * 100)
                else:
                    with self.lock:
                        self.current_command = ""
                        self.status = "SUCCESS"
            except Exception:
                with self.lock:
                    self.current_command = ""
                    self.status = "FAILED"
            finally:
                self.queue.task_done()

    @staticmethod
    def _packet_tracer_window() -> Any:
        if pygetwindow is None:
            return None
        windows = pygetwindow.getAllTitles()
        for title in windows:
            if title and any(expected.lower() in title.lower() for expected in PACKET_TRACER_TITLES):
                matches = pygetwindow.getWindowsWithTitle(title)
                return matches[0] if matches else None
        return None


state = BridgeState()


class BridgeHandler(BaseHTTPRequestHandler):
    def _send(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send({"ok": True})

    def do_GET(self) -> None:
        if self.path == "/status":
            self._send(state.snapshot())
        else:
            self._send({"error": "Not found"}, 404)

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/connect":
                result = state.connect()
            elif self.path == "/disconnect":
                result = state.disconnect()
            elif self.path == "/regenerate-code":
                result = state.regenerate_code()
            elif self.path == "/commands":
                result = state.send_commands(body.get("commands", []))
            elif self.path == "/cancel":
                result = state.cancel()
            else:
                self._send({"error": "Not found"}, 404)
                return
            self._send(result)
        except (ConnectionError, RuntimeError, ValueError) as error:
            self._send({"error": str(error)}, 409)
        except (json.JSONDecodeError, TypeError):
            self._send({"error": "Invalid JSON body"}, 400)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[bridge] {format % args}")


if __name__ == "__main__":
    print(f"Cisco Local Bridge listening on http://{HOST}:{PORT}")
    print("No keyboard input will be sent until /connect and /commands are called.")
    ThreadingHTTPServer((HOST, PORT), BridgeHandler).serve_forever()
