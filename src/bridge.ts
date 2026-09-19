import type { BridgeSnapshot } from './types'

export const BRIDGE_URL = (import.meta.env.VITE_BRIDGE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '')

async function request(path: string, options?: RequestInit): Promise<BridgeSnapshot> {
  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options })
    const body = await response.json() as BridgeSnapshot & { error?: string }
    if (!response.ok) throw new Error(body.error || `Local Bridge returned HTTP ${response.status}`)
    return body
  } catch (error) {
    if (error instanceof Error && !['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'].includes(error.message)) throw error
    throw new Error(`Local Bridge tidak dapat diakses di ${BRIDGE_URL}. Jalankan local-bridge atau gunakan HTTPS tunnel.`)
  }
}

export const bridgeApi = {
  getStatus: () => request('/status'),
  connect: () => request('/connect', { method: 'POST', body: '{}' }),
  disconnect: () => request('/disconnect', { method: 'POST', body: '{}' }),
  regenerateCode: () => request('/regenerate-code', { method: 'POST', body: '{}' }),
  sendCommand: (command: string) => request('/commands', { method: 'POST', body: JSON.stringify({ commands: [command] }) }),
  sendCommands: (commands: string[]) => request('/commands', { method: 'POST', body: JSON.stringify({ commands }) }),
  cancel: () => request('/cancel', { method: 'POST', body: '{}' }),
}
