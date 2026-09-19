# Cisco Auto Configurator

Prototype untuk membuat, memvalidasi, preview, dan menjalankan command Cisco melalui Simulation Mode atau Device Mode. Remote Mode memakai Connection Service HTTP dengan session token yang expire otomatis.

## 1. Instalasi Web
```powershell
npm install
```

## 2. Instalasi Python
Install Python 3.10+ dan pastikan `python --version` tersedia.

## 3. Instalasi PyAutoGUI
```powershell
cd local-bridge
pip install -r requirements.txt
```
Requirements juga memasang `pygetwindow` untuk mendeteksi dan memfokuskan window Cisco Packet Tracer.

## 4. Menjalankan Web Lokal
```powershell
npm run dev
```
Buka `http://127.0.0.1:5173/`. Untuk lokal, frontend memakai `http://127.0.0.1:8787` sebagai Connection Service default.

## 5. Menjalankan Local Bridge
```powershell
cd local-bridge
python main.py
```
Bridge berjalan di `http://127.0.0.1:5000`. Bridge tidak mengetik apa pun saat startup dan hanya memproses command setelah Confirm & Start.

Jika website Netlify sudah dideploy, jalankan Bridge dengan URL website tersebut:

```powershell
$env:CONNECTION_SERVICE_URL = "https://alamat-site-anda.netlify.app"
python main.py
```

## Connection Service Lokal
```powershell
npm run connection-service
```
Service berjalan pada `http://127.0.0.1:8787`.

## Deploy ke Netlify

Frontend dan Connection Service dideploy bersamaan sebagai Netlify Function. Tidak perlu Render atau hosting backend terpisah.

1. Push project ke GitHub/GitLab.
2. Di Netlify pilih **Add new site** lalu import repository.
3. Gunakan build command `npm run build` dan publish directory `dist`.
4. Tambahkan environment variable berikut pada Netlify:

```text
VITE_BRIDGE_URL=http://127.0.0.1:5000
```

5. Deploy ulang site setelah environment variable disimpan.

`VITE_BRIDGE_URL` harus menunjuk ke Local Bridge pada komputer yang menjalankan Cisco Packet Tracer. Untuk akses dari website HTTPS, bridge perlu diekspos melalui HTTPS tunnel atau reverse proxy yang mendukung CORS; `127.0.0.1` hanya berfungsi jika browser dan bridge berada pada komputer yang sama.

`VITE_BRIDGE_URL=http://127.0.0.1:5000` hanya benar jika Device Mode dibuka pada komputer yang sama dengan Local Bridge. Untuk browser Remote di komputer lain, gunakan URL HTTPS tunnel untuk bridge dan set URL tersebut pada `VITE_BRIDGE_URL` sebelum build.

Endpoint backend tersedia pada `/api/*`. Tes dengan membuka URL site Netlify ditambah `/health`; respons yang benar berisi `ok: true`.

Catatan: storage service prototype masih in-memory. Restart atau sleep backend akan menghapus device/session/job aktif. Untuk produksi, gunakan database seperti PostgreSQL atau Redis.

## 6. Menggunakan Device Mode
1. Buka Cisco Packet Tracer dan CLI target.
2. Buka Settings, pilih Device Mode.
3. Matikan Simulation Mode jika command harus dikirim ke bridge.
4. Klik Connect Bridge.
5. Device mendaftarkan Device Code ke Connection Service.
6. Device dapat Disconnect Remote, Revoke Session, dan Regenerate Device Code.

## 7. Menggunakan Remote Mode
1. Pastikan website Netlify dan endpoint `/health` aktif.
2. Jalankan Local Bridge pada Device dengan URL website Netlify.
3. Pada browser Remote, buka URL Netlify lalu pilih Settings dan Remote Mode.
3. Masukkan Device Code dan klik Connect.
4. Setelah status READY, pilih modul, isi parameter, Generate, Preview, dan Confirm & Start.

## 8. Menghubungkan Device Code
Device Code adalah identifier pairing, bukan password. Setelah valid, service menerbitkan session token yang berlaku satu jam. Token dapat disconnect, revoke, dan expire otomatis.

## 9. Menjalankan konfigurasi
Command Remote dikirim melalui Connection Service ke Device, lalu Local Bridge menjalankan queue satu per satu. Semua modul tetap tersedia: VLAN, Access Port, Trunk, Inter-VLAN, DHCP, Static Routing, OSPF, EIGRP, BGP, NAT, ACL, Port Security, dan EtherChannel.

## 10. Cancel
Cancel dikirim dari Remote ke Device melalui service. Bridge menghentikan command berikutnya pada queue. Command yang sedang berjalan dapat menyelesaikan aksi saat ini.

## 11. Troubleshooting
- **OFFLINE:** pastikan Connection Service dan Local Bridge berjalan, lalu Connect Bridge.
- **BUSY:** tunggu job selesai atau Cancel job aktif.
- **Session expired:** Connect ulang dengan Device Code.
- **Bridge FAILED:** buka Packet Tracer dan pastikan judul window mengandung `Cisco Packet Tracer` atau `Packet Tracer`.
- **Tidak ada command:** pastikan Simulation Mode OFF, CLI Packet Tracer terbuka, lalu Confirm ulang.
- **Remote gagal connect:** buka `/health` pada site Netlify dan pastikan Local Bridge berjalan dengan URL site Netlify.

## API
Local Bridge: `GET /status`, `POST /connect`, `POST /disconnect`, `POST /regenerate-code`, `POST /commands`, `POST /cancel`.
Connection Service: device register/heartbeat/revoke, remote connect/status/disconnect, command queue, cancel, dan job status.

Tidak ada Remote Internet Connection atau informasi sensitif yang disimpan oleh prototype ini.
