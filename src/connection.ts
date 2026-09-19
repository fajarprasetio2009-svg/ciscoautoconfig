import type { BridgeSnapshot } from './types'

export const CONNECTION_SERVICE_URL = import.meta.env.VITE_CONNECTION_SERVICE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '')
type DeviceView = { deviceCode: string; status: string; connectedRemotes: number; busy: boolean }
export type RemoteJob = { id: string; status: string; progress: number; currentCommand: string; completed: string[]; commands: string[] }
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${CONNECTION_SERVICE_URL}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options })
    const body = await response.json() as T & { error?: string }
    if (!response.ok) throw new Error(body.error || `Connection Service returned HTTP ${response.status}`)
    return body
  } catch (error) {
    if (error instanceof Error && !['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'].includes(error.message)) throw error
    throw new Error('Connection Service Netlify tidak dapat diakses. Tes URL site dengan /health dan deploy ulang Functions.')
  }
}
export const connectionApi = {
  registerDevice: (deviceCode: string) => request<{ deviceToken: string; device: DeviceView }>('/api/device/register', { method: 'POST', body: JSON.stringify({ deviceCode }) }),
  heartbeat: (deviceCode: string, deviceToken: string, status: string, busy: boolean) => request<{ device: DeviceView }>('/api/device/heartbeat', { method: 'POST', body: JSON.stringify({ deviceCode, deviceToken, status, busy }) }),
  revoke: (deviceToken: string) => request<{ device: DeviceView }>('/api/device/revoke', { method: 'POST', body: JSON.stringify({ deviceToken }) }),
  disconnectRemotes: (deviceToken: string) => request<{ device: DeviceView }>('/api/device/disconnect-remotes', { method: 'POST', body: JSON.stringify({ deviceToken }) }),
  connectRemote: (deviceCode: string) => request<{ sessionToken: string; device: DeviceView }>('/api/remote/connect', { method: 'POST', body: JSON.stringify({ deviceCode }) }),
  remoteStatus: (sessionToken: string) => request<{ device: DeviceView; job: RemoteJob | null }>(`/api/remote/status?sessionToken=${encodeURIComponent(sessionToken)}`),
  sendRemoteCommands: (sessionToken: string, commands: string[]) => request<{ job: RemoteJob }>('/api/remote/commands', { method: 'POST', body: JSON.stringify({ sessionToken, commands }) }),
  cancelRemote: (sessionToken: string) => request<{ job: RemoteJob | null }>('/api/remote/cancel', { method: 'POST', body: JSON.stringify({ sessionToken }) }),
  disconnectRemote: (sessionToken: string) => request<{ ok: boolean }>('/api/remote/disconnect', { method: 'POST', body: JSON.stringify({ sessionToken }) }),
}
export type { DeviceView }
