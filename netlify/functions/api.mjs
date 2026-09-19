import { randomBytes } from 'node:crypto'

const SESSION_TTL_MS = 60 * 60 * 1000
const devices = new Map()
const sessions = new Map()
const jobs = new Map()

const token = () => randomBytes(24).toString('hex')
const now = () => Date.now()
const validCode = (value) => typeof value === 'string' && /^CCA-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value)
const deviceStatus = (device) => !device || now() - device.lastSeen > 10000 ? 'OFFLINE' : device.status
const deviceView = (device) => ({ deviceCode: device.code, status: device.busy ? 'BUSY' : deviceStatus(device), connectedRemotes: device.sessions.size, busy: device.busy })
const getDeviceByToken = (value) => [...devices.values()].find((device) => device.deviceToken === value)
const getSession = (value) => {
  const session = sessions.get(value)
  if (!session || session.expiresAt < now() || !devices.has(session.deviceCode)) {
    if (session) sessions.delete(value)
    return null
  }
  return session
}
const json = (payload, status = 200) => Response.json(payload, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
const error = (message, status) => json({ error: message }, status)

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '') || '/'
  const body = request.method === 'POST' ? await request.json().catch(() => null) : {}
  if (request.method === 'POST' && body === null) return error('Invalid JSON', 400)

  try {
    if (request.method === 'GET' && path === '/health') return json({ ok: true, service: 'cisco-connection-service' })
    if (request.method === 'POST' && path === '/api/device/register') {
      if (!validCode(body.deviceCode)) return error('Invalid Device Code', 400)
      let device = devices.get(body.deviceCode)
      if (!device) { device = { code: body.deviceCode, deviceToken: token(), lastSeen: now(), status: 'READY', busy: false, sessions: new Set(), command: null }; devices.set(body.deviceCode, device) }
      device.lastSeen = now(); device.status = 'READY'
      return json({ deviceToken: device.deviceToken, device: deviceView(device) })
    }
    if (request.method === 'POST' && path === '/api/device/heartbeat') {
      const device = getDeviceByToken(body.deviceToken)
      if (!device || body.deviceCode !== device.code) return error('Invalid device session', 401)
      device.lastSeen = now(); device.status = body.status || device.status; device.busy = Boolean(body.busy)
      return json({ device: deviceView(device) })
    }
    if (request.method === 'POST' && ['/api/device/revoke', '/api/device/disconnect-remotes'].includes(path)) {
      const device = getDeviceByToken(body.deviceToken)
      if (!device) return error('Invalid device session', 401)
      for (const sessionToken of device.sessions) sessions.delete(sessionToken)
      device.sessions.clear()
      return json({ device: deviceView(device) })
    }
    if (request.method === 'GET' && path === '/api/device/next') {
      const device = getDeviceByToken(url.searchParams.get('deviceToken'))
      if (!device) return error('Invalid device session', 401)
      device.lastSeen = now(); const command = device.command; device.command = null
      const activeJob = [...jobs.values()].find((item) => item.deviceCode === device.code && item.status === 'PROCESSING')
      return json({ job: command, cancelRequested: Boolean(activeJob?.cancelRequested), device: deviceView(device) })
    }
    if (request.method === 'POST' && path === '/api/device/job-status') {
      const device = getDeviceByToken(body.deviceToken); const job = jobs.get(body.jobId)
      if (!device || !job || job.deviceCode !== device.code) return error('Invalid device job', 401)
      job.status = body.status; job.progress = body.progress ?? job.progress; job.currentCommand = body.currentCommand || ''; job.completed = body.completed || job.completed
      device.status = body.status; device.busy = body.status === 'PROCESSING'
      return json({ ok: true })
    }
    if (request.method === 'GET' && path === '/api/device/control') {
      const device = getDeviceByToken(url.searchParams.get('deviceToken')); const job = jobs.get(url.searchParams.get('jobId'))
      if (!device || !job || job.deviceCode !== device.code) return error('Invalid device job', 401)
      return json({ cancelRequested: Boolean(job.cancelRequested) })
    }
    if (request.method === 'POST' && path === '/api/remote/connect') {
      if (!validCode(body.deviceCode)) return error('Invalid Device Code format', 400)
      const device = devices.get(body.deviceCode)
      if (!device || deviceStatus(device) === 'OFFLINE') return error('Device is OFFLINE', 409)
      if (device.busy) return error('Device is BUSY', 409)
      const sessionToken = token(); const session = { token: sessionToken, deviceCode: device.code, expiresAt: now() + SESSION_TTL_MS }
      sessions.set(sessionToken, session); device.sessions.add(sessionToken)
      return json({ sessionToken, expiresAt: session.expiresAt, device: deviceView(device) })
    }
    if (request.method === 'GET' && path === '/api/remote/status') {
      const session = getSession(url.searchParams.get('sessionToken'))
      if (!session) return error('Session expired or invalid', 401)
      return json({ sessionExpiresAt: session.expiresAt, device: deviceView(devices.get(session.deviceCode)), job: [...jobs.values()].find((item) => item.sessionToken === session.token) || null })
    }
    if (request.method === 'POST' && path === '/api/remote/commands') {
      const session = getSession(body.sessionToken)
      if (!session) return error('Session expired or invalid', 401)
      const device = devices.get(session.deviceCode)
      if (deviceStatus(device) === 'OFFLINE') return error('Device is OFFLINE', 409)
      if (device.busy) return error('Device is BUSY', 409)
      if (!Array.isArray(body.commands) || !body.commands.length || body.commands.some((command) => typeof command !== 'string' || !command.trim())) return error('Invalid command queue', 400)
      const job = { id: token(), sessionToken: session.token, deviceCode: device.code, commands: body.commands, completed: [], currentCommand: '', progress: 0, status: 'PROCESSING' }
      jobs.set(job.id, job); device.busy = true; device.command = job
      return json({ job })
    }
    if (request.method === 'POST' && path === '/api/remote/cancel') {
      const session = getSession(body.sessionToken)
      if (!session) return error('Session expired or invalid', 401)
      const job = [...jobs.values()].find((item) => item.sessionToken === session.token && item.status === 'PROCESSING')
      if (job) job.cancelRequested = true
      return json({ job: job || null })
    }
    if (request.method === 'POST' && ['/api/remote/disconnect', '/api/remote/revoke'].includes(path)) {
      const session = getSession(body.sessionToken)
      if (!session) return error('Session expired or invalid', 401)
      const device = devices.get(session.deviceCode); device.sessions.delete(session.token); sessions.delete(session.token)
      return json({ ok: true })
    }
    return error('Not found', 404)
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : 'Request failed', 400)
  }
}

export const config = { path: ['/health', '/api/*'] }
