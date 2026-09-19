import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const HOST = '0.0.0.0'
const PORT = Number(process.env.PORT || process.env.CONNECTION_SERVICE_PORT || 8787)
const SESSION_TTL_MS = 60 * 60 * 1000
const devices = new Map()
const sessions = new Map()
const jobs = new Map()

const token = () => randomBytes(24).toString('hex')
const now = () => Date.now()
const send = (res, status, payload) => { const body = JSON.stringify(payload); res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); res.end(body) }
const read = (req) => new Promise((resolve, reject) => { let data = ''; req.on('data', (chunk) => { data += chunk }); req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch { reject(new Error('Invalid JSON')) } }) })
const validCode = (value) => typeof value === 'string' && /^CCA-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value)
const deviceStatus = (device) => !device || now() - device.lastSeen > 10000 ? 'OFFLINE' : device.status
const deviceView = (device) => ({ deviceCode: device.code, status: device.busy ? 'BUSY' : deviceStatus(device), connectedRemotes: device.sessions.size, busy: device.busy })
const getDeviceByToken = (value) => [...devices.values()].find((device) => device.deviceToken === value)
const getSession = (value) => { const session = sessions.get(value); if (!session || session.expiresAt < now() || !devices.has(session.deviceCode)) { if (session) sessions.delete(value); return null } return session }

setInterval(() => { for (const [sessionToken, session] of sessions) if (session.expiresAt < now()) sessions.delete(sessionToken) }, 60_000)

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'cisco-connection-service' })
    const body = req.method === 'POST' ? await read(req) : {}
    if (req.method === 'POST' && url.pathname === '/api/device/register') {
      if (!validCode(body.deviceCode)) return send(res, 400, { error: 'Invalid Device Code' })
      let device = devices.get(body.deviceCode)
      if (!device) { device = { code: body.deviceCode, deviceToken: token(), lastSeen: now(), status: 'READY', busy: false, sessions: new Set(), command: null }; devices.set(body.deviceCode, device) }
      device.lastSeen = now(); device.status = 'READY'
      return send(res, 200, { deviceToken: device.deviceToken, device: deviceView(device) })
    }
    if (req.method === 'POST' && url.pathname === '/api/device/heartbeat') {
      const device = getDeviceByToken(body.deviceToken)
      if (!device || body.deviceCode !== device.code) return send(res, 401, { error: 'Invalid device session' })
      device.lastSeen = now(); device.status = body.status || device.status; device.busy = Boolean(body.busy)
      return send(res, 200, { device: deviceView(device) })
    }
    if (req.method === 'POST' && url.pathname === '/api/device/revoke') {
      const device = getDeviceByToken(body.deviceToken)
      if (!device) return send(res, 401, { error: 'Invalid device session' })
      for (const sessionToken of device.sessions) sessions.delete(sessionToken)
      device.sessions.clear(); return send(res, 200, { device: deviceView(device) })
    }
    if (req.method === 'POST' && url.pathname === '/api/device/disconnect-remotes') {
      const device = getDeviceByToken(body.deviceToken)
      if (!device) return send(res, 401, { error: 'Invalid device session' })
      for (const sessionToken of device.sessions) sessions.delete(sessionToken)
      device.sessions.clear(); return send(res, 200, { device: deviceView(device) })
    }
    if (req.method === 'GET' && url.pathname === '/api/device/next') {
      const device = getDeviceByToken(url.searchParams.get('deviceToken'))
      if (!device) return send(res, 401, { error: 'Invalid device session' })
      device.lastSeen = now(); const command = device.command; device.command = null
      const activeJob = [...jobs.values()].find((item) => item.deviceCode === device.code && item.status === 'PROCESSING')
      return send(res, 200, { job: command, cancelRequested: Boolean(activeJob?.cancelRequested), device: deviceView(device) })
    }
    if (req.method === 'POST' && url.pathname === '/api/device/job-status') {
      const device = getDeviceByToken(body.deviceToken); const job = jobs.get(body.jobId)
      if (!device || !job || job.deviceCode !== device.code) return send(res, 401, { error: 'Invalid device job' })
      job.status = body.status; job.progress = body.progress ?? job.progress; job.currentCommand = body.currentCommand || ''; job.completed = body.completed || job.completed
      device.status = body.status; device.busy = body.status === 'PROCESSING'
      return send(res, 200, { ok: true })
    }
    if (req.method === 'GET' && url.pathname === '/api/device/control') {
      const device = getDeviceByToken(url.searchParams.get('deviceToken')); const job = jobs.get(url.searchParams.get('jobId'))
      if (!device || !job || job.deviceCode !== device.code) return send(res, 401, { error: 'Invalid device job' })
      return send(res, 200, { cancelRequested: Boolean(job.cancelRequested) })
    }
    if (req.method === 'POST' && url.pathname === '/api/remote/connect') {
      if (!validCode(body.deviceCode)) return send(res, 400, { error: 'Invalid Device Code format' })
      const device = devices.get(body.deviceCode); if (!device || deviceStatus(device) === 'OFFLINE') return send(res, 409, { error: 'Device is OFFLINE' })
      if (device.busy) return send(res, 409, { error: 'Device is BUSY' })
      const sessionToken = token(); const session = { token: sessionToken, deviceCode: device.code, expiresAt: now() + SESSION_TTL_MS }; sessions.set(sessionToken, session); device.sessions.add(sessionToken)
      return send(res, 200, { sessionToken, expiresAt: session.expiresAt, device: deviceView(device) })
    }
    if (req.method === 'GET' && url.pathname === '/api/remote/status') {
      const session = getSession(url.searchParams.get('sessionToken')); if (!session) return send(res, 401, { error: 'Session expired or invalid' })
      return send(res, 200, { sessionExpiresAt: session.expiresAt, device: deviceView(devices.get(session.deviceCode)), job: [...jobs.values()].find((item) => item.sessionToken === session.token) || null })
    }
    if (req.method === 'POST' && url.pathname === '/api/remote/commands') {
      const session = getSession(body.sessionToken); if (!session) return send(res, 401, { error: 'Session expired or invalid' })
      const device = devices.get(session.deviceCode); if (deviceStatus(device) === 'OFFLINE') return send(res, 409, { error: 'Device is OFFLINE' }); if (device.busy) return send(res, 409, { error: 'Device is BUSY' })
      if (!Array.isArray(body.commands) || !body.commands.length || body.commands.some((command) => typeof command !== 'string' || !command.trim())) return send(res, 400, { error: 'Invalid command queue' })
      const job = { id: token(), sessionToken: session.token, deviceCode: device.code, commands: body.commands, completed: [], currentCommand: '', progress: 0, status: 'PROCESSING' }; jobs.set(job.id, job); device.busy = true; device.command = job
      return send(res, 200, { job })
    }
    if (req.method === 'POST' && url.pathname === '/api/remote/cancel') {
      const session = getSession(body.sessionToken); if (!session) return send(res, 401, { error: 'Session expired or invalid' }); const job = [...jobs.values()].find((item) => item.sessionToken === session.token && item.status === 'PROCESSING'); if (job) job.cancelRequested = true; return send(res, 200, { job: job || null })
    }
    if (req.method === 'POST' && ['/api/remote/disconnect', '/api/remote/revoke'].includes(url.pathname)) {
      const session = getSession(body.sessionToken); if (!session) return send(res, 401, { error: 'Session expired or invalid' }); const device = devices.get(session.deviceCode); device.sessions.delete(session.token); sessions.delete(session.token); return send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'Not found' })
  } catch (error) { return send(res, 400, { error: error.message }) }
})

server.listen(PORT, HOST, () => console.log(`Connection Service listening on http://127.0.0.1:${PORT}`))
