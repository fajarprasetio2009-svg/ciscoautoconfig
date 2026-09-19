import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowLeft, Check, ChevronDown, CircleHelp, Clock3, Code2, Copy, Gauge, LayoutDashboard, Menu, Play, RotateCcw, Search, Settings, ShieldCheck, SlidersHorizontal, Terminal, X } from 'lucide-react'
import { configDefinitions, getDefinition } from './configDefinitions'
import { bridgeApi } from './bridge'
import { connectionApi, type DeviceView } from './connection'
import { generateCommands } from './generators'
import { validateForm } from './validation'
import type { BridgeSnapshot, ConfigType, ConfigValues, HistoryItem } from './types'
import './styles.css'

const groups = ['Switching', 'Routing', 'Services', 'Security']
const starterHistory: HistoryItem[] = [
  { id: '1', type: 'eigrp', name: 'EIGRP Core Network', status: 'Successful', time: 'Today, 09:42', commands: ['enable', 'configure terminal', 'router eigrp 100'] },
  { id: '2', type: 'vlan', name: 'VLAN Operations', status: 'Successful', time: 'Yesterday, 16:18', commands: ['enable', 'configure terminal', 'vlan 20'] },
]

function App() {
  const [active, setActive] = useState<ConfigType>('vlan')
  const [page, setPage] = useState<'dashboard' | 'config' | 'history' | 'settings' | 'about'>('dashboard')
  const [values, setValues] = useState<ConfigValues>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [commands, setCommands] = useState<string[]>([])
  const [stage, setStage] = useState<'form' | 'preview' | 'processing' | 'success' | 'failed' | 'cancelled'>('form')
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const stored = localStorage.getItem('cisco-history')
      return stored ? JSON.parse(stored) : starterHistory
    } catch {
      return starterHistory
    }
  })
  const [copied, setCopied] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [connectionMode, setConnectionMode] = useState<'device' | 'remote' | null>(null)
  const [simulationMode, setSimulationMode] = useState(true)
  const [bridge, setBridge] = useState<BridgeSnapshot>({ connected: false, status: 'OFFLINE', device_code: 'CCA-7X92-KP41', job_id: null, commands: [], completed: [], current_command: '', progress: 0 })
  const [bridgeError, setBridgeError] = useState('')
  const [deviceToken, setDeviceToken] = useState('')
  const [remoteCode, setRemoteCode] = useState('')
  const [remoteSession, setRemoteSession] = useState('')
  const [remoteDevice, setRemoteDevice] = useState<DeviceView | null>(null)
  const definition = getDefinition(active)

  useEffect(() => localStorage.setItem('cisco-history', JSON.stringify(history)), [history])
  useEffect(() => { if (page === 'settings') setConnectionMode(null) }, [page])
  const openConfig = (id: ConfigType) => { setActive(id); setPage('config'); setValues({}); setErrors({}); setCommands([]); setStage('form'); setSidebarOpen(false) }
  const generate = () => { const nextErrors = validateForm(definition, values); setErrors(nextErrors); if (!Object.keys(nextErrors).length) { setCommands(generateCommands(active, values)); setStage('preview') } }
  useEffect(() => {
    if (connectionMode !== 'device' || simulationMode) return
    const poll = window.setInterval(() => { bridgeApi.getStatus().then(setBridge).catch(() => setBridge((current) => ({ ...current, connected: false, status: 'OFFLINE' }))) }, 500)
    return () => window.clearInterval(poll)
  }, [connectionMode, simulationMode])
  useEffect(() => {
    if (connectionMode !== 'remote' || !remoteSession) return
    const poll = window.setInterval(() => connectionApi.remoteStatus(remoteSession).then(({ device, job }) => {
      setRemoteDevice(device)
      if (job) {
        setBridge((current) => ({ ...current, status: job.status as BridgeSnapshot['status'], progress: job.progress, current_command: job.currentCommand, completed: job.completed, commands: job.commands }))
        if (stage === 'processing' && (job.status === 'SUCCESS' || job.status === 'FAILED')) {
          setStage(job.status === 'SUCCESS' ? 'success' : 'failed')
          setHistory((items) => [{ id: Date.now().toString(), type: active, name: definition.label, status: job.status === 'SUCCESS' ? 'Successful' : 'Failed', time: 'Just now', commands: job.commands }, ...items])
        }
      }
    }).catch((error) => setBridgeError(error instanceof Error ? error.message : 'Remote session unavailable.')), 700)
    return () => window.clearInterval(poll)
  }, [active, definition.label, remoteSession, stage])
  useEffect(() => {
    if (simulationMode || stage !== 'processing' || bridge.status === 'PROCESSING') return
    if (bridge.status === 'SUCCESS' || bridge.status === 'FAILED') {
      const success = bridge.status === 'SUCCESS'
      setStage(success ? 'success' : 'failed')
      setHistory((items) => [{ id: Date.now().toString(), type: active, name: definition.label, status: success ? 'Successful' : 'Failed', time: 'Just now', commands }, ...items])
    }
  }, [active, bridge.status, commands, definition.label, simulationMode, stage])
  const confirm = async () => {
    setStage('processing')
    setBridgeError('')
    if (!connectionMode) { setBridgeError('Pilih Device Mode atau Remote Mode di Settings terlebih dahulu.'); setStage('failed'); return }
    if (connectionMode === 'remote') {
      try { const response = await connectionApi.sendRemoteCommands(remoteSession, commands); setBridge((current) => ({ ...current, status: 'PROCESSING', progress: response.job.progress, current_command: '', completed: [], commands: response.job.commands })) } catch (error) { setBridgeError(error instanceof Error ? error.message : 'Remote device rejected the command.'); setStage('failed') }
      return
    }
    if (!simulationMode) {
      try {
        const snapshot = await bridgeApi.sendCommands(commands)
        setBridge(snapshot)
      } catch (error) {
        setBridgeError(error instanceof Error ? error.message : 'Local Bridge is unavailable.')
        setStage('failed')
      }
      return
    }
    window.setTimeout(() => { const success = Math.random() > 0.08; setStage(success ? 'success' : 'failed'); setHistory((items) => [{ id: Date.now().toString(), type: active, name: definition.label, status: success ? 'Successful' : 'Failed', time: 'Just now', commands }, ...items]) }, 1100)
  }
  const connectBridge = async () => {
    setBridgeError('')
    try {
      const local = await bridgeApi.connect()
      try {
        const registered = await connectionApi.registerDevice(local.device_code)
        setDeviceToken(registered.deviceToken); setRemoteDevice(registered.device); setBridge(local)
      } catch (error) { setBridgeError(error instanceof Error ? error.message : 'Connection Service tidak tersedia.') }
    } catch (error) { setBridgeError(error instanceof Error ? error.message : 'Local Bridge tidak tersedia.') }
  }
  const disconnectBridge = async () => { try { setBridge(await bridgeApi.disconnect()) } catch { setBridge((current) => ({ ...current, connected: false, status: 'OFFLINE' })) } }
  const regenerateCode = async () => { try { const local = await bridgeApi.regenerateCode(); setBridge(local); if (deviceToken) { const registered = await connectionApi.registerDevice(local.device_code); setDeviceToken(registered.deviceToken) } } catch (error) { setBridgeError(error instanceof Error ? error.message : 'Bridge atau Connection Service tidak tersedia.') } }
  const connectRemote = async () => { try { const response = await connectionApi.connectRemote(remoteCode.trim().toUpperCase()); setRemoteSession(response.sessionToken); setRemoteDevice(response.device); setBridge((current) => ({ ...current, connected: true, status: response.device.status as BridgeSnapshot['status'], device_code: response.device.deviceCode })); setBridgeError('') } catch (error) { setBridgeError(error instanceof Error ? error.message : 'Device tidak dapat dihubungkan.') } }
  const disconnectRemote = async () => { if (remoteSession) await connectionApi.disconnectRemote(remoteSession).catch(() => undefined); setRemoteSession(''); setRemoteDevice(null); setBridge((current) => ({ ...current, connected: false, status: 'OFFLINE' })) }
  const revokeRemote = async () => { if (deviceToken) await connectionApi.revoke(deviceToken).catch(() => undefined); setRemoteSession(''); setRemoteDevice(null) }
  const disconnectRemotes = async () => { if (deviceToken) { const response = await connectionApi.disconnectRemotes(deviceToken).catch(() => null); if (response) setRemoteDevice(response.device) } }
  const cancel = async () => { if (connectionMode === 'remote') { try { await connectionApi.cancelRemote(remoteSession); setStage('cancelled') } catch { setStage('failed') } } else if (connectionMode === 'device' && simulationMode) setStage('cancelled'); else if (connectionMode === 'device') { try { setBridge(await bridgeApi.cancel()); setStage('cancelled') } catch { setStage('failed') } } }
  const copy = async () => { await navigator.clipboard.writeText(commands.join('\n')); setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
  const completed = history.filter((item) => item.status === 'Successful').length

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Terminal size={19} /></div><div><strong>Cisco</strong><span>Auto Configurator</span></div><button className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
      <nav className="main-nav">
        <button className={page === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => { setPage('dashboard'); setSidebarOpen(false) }}><LayoutDashboard size={18} /> Dashboard</button>
        <p className="nav-label">Configurations <ChevronDown size={13} /></p>
        {groups.map((group) => <div className="config-group" key={group}><span className="group-title">{group}</span>{configDefinitions.filter((item) => item.group === group).map((item) => <button className={page === 'config' && active === item.id ? 'nav-item sub active' : 'nav-item sub'} key={item.id} onClick={() => openConfig(item.id)}>{item.label}</button>)}</div>)}
        <div className="nav-bottom"><button className={page === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('history')}><Clock3 size={18} /> History <b>{history.length}</b></button><button className={page === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('settings')}><Settings size={18} /> Settings</button><button className={page === 'about' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('about')}><CircleHelp size={18} /> About</button></div>
      </nav>
      <div className="connection-card"><span className={`status-dot ${bridge.status.toLowerCase()}`} /> <div><strong>Local Bridge {simulationMode ? 'simulation' : bridge.status.toLowerCase()}</strong><small>{simulationMode ? 'Simulation Mode ON' : bridge.connected ? bridge.device_code : 'Disconnected'}</small></div><Activity size={17} /></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><button className="menu-button" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{page === 'config' ? definition.label : page[0].toUpperCase() + page.slice(1)}</strong></div><div className="top-actions"><div className="search"><Search size={16} /><input placeholder="Search configurations" /></div><button className="icon-button"><SlidersHorizontal size={18} /></button><div className="avatar">CA</div></div></header>
      {page === 'dashboard' && <Dashboard history={history} completed={completed} onOpen={openConfig} />}
      {page === 'config' && <ConfigWorkspace definition={definition} values={values} errors={errors} commands={commands} stage={stage} copied={copied} simulationMode={simulationMode} bridge={bridge} bridgeError={bridgeError} onChange={(key, value) => setValues({ ...values, [key]: value })} onGenerate={generate} onConfirm={confirm} onCopy={copy} onClear={() => { setValues({}); setErrors({}); setCommands([]); setStage('form') }} onEdit={() => setStage('form')} onCancel={cancel} />}
      {page === 'history' && <HistoryView history={history} />}
      {page === 'settings' && <SettingsPage connectionMode={connectionMode} simulationMode={simulationMode} bridge={bridge} remoteDevice={remoteDevice} remoteCode={remoteCode} remoteSession={remoteSession} error={bridgeError} onRemoteCode={setRemoteCode} onModeChange={setConnectionMode} onSimulationChange={setSimulationMode} onConnect={connectBridge} onDisconnect={disconnectBridge} onRegenerate={regenerateCode} onConnectRemote={connectRemote} onDisconnectRemote={disconnectRemote} onRevoke={revokeRemote} onDisconnectRemotes={disconnectRemotes} />}
      {page === 'about' && <SimplePage icon={<ShieldCheck />} title="About Cisco Auto Configurator" text="A focused command builder for Cisco configuration workflows. This version uses a simulator and never connects to network devices." />}
    </main>
  </div>
}

function Dashboard({ history, completed, onOpen }: { history: HistoryItem[]; completed: number; onOpen: (id: ConfigType) => void }) { return <section className="page"><div className="page-heading"><div><p className="eyebrow">COMMAND CENTER / OVERVIEW</p><h1>Good morning, operator.</h1><p className="muted">Build, review, and simulate Cisco configurations from one workspace.</p></div><button className="primary-button" onClick={() => onOpen('vlan')}><Play size={16} /> New configuration</button></div><div className="metric-grid"><Metric label="Total configurations" value={history.length + 18} detail="Across this workspace" icon={<Code2 />} /><Metric label="Successful" value={completed + 16} detail="92.8% success rate" icon={<Check />} tone="green" /><Metric label="Failed" value={history.filter((item) => item.status === 'Failed').length + 1} detail="Needs attention" icon={<X />} tone="red" /><Metric label="Connection status" value="Ready" detail="Simulator online" icon={<Activity />} tone="blue" /></div><div className="dashboard-grid"><div className="panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Recent configurations</h2></div><button className="text-button">View history <ArrowLeft size={14} /></button></div><div className="history-list">{history.slice(0, 4).map((item) => <HistoryRow item={item} key={item.id} />)}</div></div><div className="panel quick-panel"><p className="eyebrow">QUICK START</p><h2>Choose a module</h2><p className="muted">Start with a common switch or routing task.</p><div className="quick-links">{['vlan', 'access-port', 'trunk', 'ospf'].map((id) => { const item = getDefinition(id as ConfigType); return <button key={id} onClick={() => onOpen(item.id)}><span>{item.label}</span><ArrowLeft size={15} /></button> })}</div></div></div></section> }
function Metric({ label, value, detail, icon, tone = '' }: { label: string; value: string | number; detail: string; icon: React.ReactNode; tone?: string }) { return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div> }
function HistoryRow({ item }: { item: HistoryItem }) { return <div className="history-row"><div className="row-icon"><Terminal size={16} /></div><div className="row-copy"><strong>{item.name}</strong><span>{getDefinition(item.type).label} · {item.time}</span></div><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></div> }
function HistoryView({ history }: { history: HistoryItem[] }) { return <section className="page"><div className="page-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h1>Configuration history</h1><p className="muted">Every generated workflow, kept locally for review.</p></div></div><div className="panel full-panel"><div className="history-list">{history.map((item) => <HistoryRow item={item} key={item.id} />)}</div></div></section> }
function SimplePage({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <section className="page centered-page"><div className="empty-icon">{icon}</div><h1>{title}</h1><p className="muted">{text}</p></section> }
function SettingsPage({ connectionMode, simulationMode, bridge, remoteDevice, remoteCode, remoteSession, error, onRemoteCode, onModeChange, onSimulationChange, onConnect, onDisconnect, onRegenerate, onConnectRemote, onDisconnectRemote, onRevoke, onDisconnectRemotes }: { connectionMode: 'device' | 'remote' | null; simulationMode: boolean; bridge: BridgeSnapshot; remoteDevice: DeviceView | null; remoteCode: string; remoteSession: string; error: string; onRemoteCode: (code: string) => void; onModeChange: (mode: 'device' | 'remote') => void; onSimulationChange: (enabled: boolean) => void; onConnect: () => void; onDisconnect: () => void; onRegenerate: () => void; onConnectRemote: () => void; onDisconnectRemote: () => void; onRevoke: () => void; onDisconnectRemotes: () => void }) {
  if (!connectionMode) return <section className="page settings-page"><div className="page-heading"><div><p className="eyebrow">WORKSPACE CONTROL</p><h1>Select connection mode</h1><p className="muted">Choose one mode before configuring a device connection.</p></div></div><div className="mode-choice-grid"><button className="mode-choice panel" onClick={() => onModeChange('device')}><span className="mode-choice-icon"><Terminal size={20} /></span><strong>Device Mode</strong><small>Connect this browser to a Local Bridge and Cisco Packet Tracer.</small></button><button className="mode-choice panel" onClick={() => onModeChange('remote')}><span className="mode-choice-icon"><Activity size={20} /></span><strong>Remote Mode</strong><small>Connect to a registered device using its Device Code.</small></button></div></section>
  return <section className="page settings-page"><div className="page-heading"><div><p className="eyebrow">WORKSPACE CONTROL</p><h1>Settings</h1><p className="muted">Choose how commands leave the web application.</p></div></div><div className="settings-grid"><div className="panel settings-panel"><div className="panel-heading"><div><p className="eyebrow">CONNECTION MODE</p><h2>{connectionMode === 'device' ? 'Device Mode' : 'Remote Mode'}</h2></div><span className={`status-pill ${(remoteDevice?.status || bridge.status).toLowerCase()}`}>{remoteDevice?.status || bridge.status}</span></div><div className="segmented"><button className={connectionMode === 'device' ? 'selected' : ''} onClick={() => onModeChange('device')}>Device Mode</button><button className={connectionMode === 'remote' ? 'selected' : ''} onClick={() => onModeChange('remote')}>Remote Mode</button></div>{connectionMode === 'remote' ? <><div className="remote-connect"><label>Device Code<input value={remoteCode} onChange={(event) => onRemoteCode(event.target.value.toUpperCase())} placeholder="CCA-7X92-KP41" /></label><button className="primary-button" onClick={onConnectRemote} disabled={Boolean(remoteSession)}>Connect</button></div>{remoteDevice && <div className="device-code"><span>CONNECTED DEVICE</span><strong>{remoteDevice.deviceCode}</strong><small>{remoteDevice.status} · Session expires automatically</small></div>}<div className="settings-actions"><button className="quiet-button" onClick={onDisconnectRemote} disabled={!remoteSession}>Disconnect</button><button className="danger-button" onClick={onRevoke} disabled={!remoteSession}>Revoke Session</button></div></> : <><div className="device-code"><span>DEVICE CODE</span><strong>{bridge.device_code}</strong><small>Share this code with an authorized Remote Mode user. {remoteDevice?.connectedRemotes ?? 0} Remote connected.</small></div><div className="settings-actions"><button className="quiet-button" onClick={onRegenerate}>Regenerate Code</button><button className="quiet-button" onClick={onDisconnectRemotes} disabled={!remoteDevice?.connectedRemotes}>Disconnect Remote</button><button className="danger-button" onClick={onRevoke} disabled={!remoteDevice?.connectedRemotes}>Revoke Session</button>{bridge.connected ? <button className="danger-button" onClick={onDisconnect}>Disconnect Bridge</button> : <button className="primary-button" onClick={onConnect}>Connect Bridge</button>}</div><div className="mode-toggle"><div><strong>Simulation Mode</strong><span>{simulationMode ? 'Commands use the browser mock.' : 'Commands use Python Local Bridge.'}</span></div><button className={`toggle ${simulationMode ? 'on' : ''}`} aria-label="Toggle Simulation Mode" onClick={() => onSimulationChange(!simulationMode)}><i /></button></div></>}{error && <p className="bridge-error">{error}</p>}</div><div className="panel settings-panel bridge-info"><p className="eyebrow">CONNECTION SERVICE</p><h2>Web ↕ Device ↕ Local Bridge</h2><p className="muted">Remote commands travel through the connection service and are executed by the registered Device bridge only.</p><div className="status-line"><span className={`status-dot ${(remoteDevice?.status || bridge.status).toLowerCase()}`} /> <strong>{remoteDevice ? remoteDevice.status : simulationMode ? 'SIMULATION' : bridge.status}</strong><span>{bridge.progress}%</span></div></div></div></section>
}

function ConfigWorkspace({ definition, values, errors, commands, stage, copied, simulationMode, bridge, bridgeError, onChange, onGenerate, onConfirm, onCopy, onClear, onEdit, onCancel }: { definition: ReturnType<typeof getDefinition>; values: ConfigValues; errors: Record<string, string>; commands: string[]; stage: string; copied: boolean; simulationMode: boolean; bridge: BridgeSnapshot; bridgeError: string; onChange: (key: string, value: string) => void; onGenerate: () => void; onConfirm: () => void; onCopy: () => void; onClear: () => void; onEdit: () => void; onCancel: () => void }) {
  const isResult = ['processing', 'success', 'failed', 'cancelled'].includes(stage)
  return <section className="page config-page"><div className="page-heading"><div><p className="eyebrow">CONFIGURATION MODULE</p><h1>{definition.label}</h1><p className="muted">{definition.description}</p></div><div className="module-badge"><Gauge size={16} /> {simulationMode ? 'Simulation Mode' : 'Device Mode'}</div></div><div className="workflow"><span className={stage !== 'form' ? 'done' : 'current'}>01 <b>Form</b></span><i /><span className={stage !== 'form' ? 'current' : ''}>02 <b>Preview</b></span><i /><span className={isResult ? 'current' : ''}>03 <b>Confirm</b></span><i /><span className={['success', 'failed', 'cancelled'].includes(stage) ? 'current' : ''}>04 <b>Result</b></span></div><div className="config-grid"><div className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">INPUT PARAMETERS</p><h2>Configuration details</h2></div><span className="required-note">* Required</span></div><div className="form-fields">{definition.fields.map((field) => <label key={field.key}>{field.label}<span className="required">*</span>{field.type === 'select' ? <select value={values[field.key] || ''} onChange={(event) => onChange(field.key, event.target.value)}><option value="">{field.placeholder}</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.type === 'number' ? 'number' : 'text'} value={values[field.key] || ''} placeholder={field.placeholder} onChange={(event) => onChange(field.key, event.target.value)} />}{errors[field.key] && <em>{errors[field.key]}</em>}</label>)}</div><div className="form-actions"><button className="quiet-button" onClick={onClear}><RotateCcw size={15} /> Clear</button><button className="primary-button" onClick={onGenerate}><Code2 size={16} /> Generate command</button></div></div><div className="panel preview-panel"><div className="panel-heading"><div><p className="eyebrow">COMMAND PREVIEW</p><h2>Generated output</h2></div>{commands.length > 0 && <button className="copy-button" onClick={onCopy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>}</div><div className="terminal-window">{commands.length ? <pre>{commands.map((command, index) => <code key={`${command}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span>{command}</code>)}</pre> : <div className="preview-empty"><Terminal size={28} /><strong>Your commands will appear here</strong><span>Fill the form and generate a preview to continue.</span></div>}</div>{stage === 'processing' && !simulationMode && <div className="bridge-progress"><div className="progress-heading"><strong>Processing {bridge.progress}%</strong><span>{bridge.current_command || 'Preparing queue...'}</span></div><div className="progress-track"><i style={{ width: `${bridge.progress}%` }} /></div><div className="progress-details"><span>{bridge.completed.length} of {commands.length} commands complete</span><button className="danger-button" onClick={onCancel}>Cancel</button></div>{bridge.completed.length > 0 && <div className="completed-commands">{bridge.completed.map((command, index) => <code key={`${command}-${index}`}><Check size={12} /> {command}</code>)}</div>}</div>}{stage === 'preview' && <div className="confirm-box"><div><strong>Ready to start?</strong><span>{simulationMode ? 'Review before running the simulation.' : bridge.connected ? 'Commands will be sent to the connected Local Bridge.' : 'Connect the Local Bridge in Settings first.'}</span></div><button className="primary-button" disabled={!simulationMode && !bridge.connected} onClick={onConfirm}><Play size={15} /> Confirm & start</button></div>}{stage === 'processing' && simulationMode && <ResultBox tone="processing" title="Processing configuration" text="Running a local simulation..." onCancel={onCancel} />}{stage === 'success' && <ResultBox tone="success" title="Configuration successful" text={simulationMode ? 'The simulated command run completed successfully.' : 'The Local Bridge completed every command.'} />}{stage === 'failed' && <ResultBox tone="failed" title="Configuration failed" text={bridgeError || 'Review the command queue and try again.'} />}{stage === 'cancelled' && <ResultBox tone="cancelled" title="Configuration cancelled" text="The command queue was stopped." />}</div></div></section>
}
function ResultBox({ tone, title, text, onCancel }: { tone: string; title: string; text: string; onCancel?: () => void }) { return <div className={`result-box ${tone}`}><div className="result-icon">{tone === 'success' ? <Check /> : tone === 'processing' ? <Activity /> : <X />}</div><div><strong>{title}</strong><span>{text}</span></div>{onCancel && <button className="quiet-button" onClick={onCancel}>Cancel</button>}</div> }

export default App

createRoot(document.getElementById('root')!).render(<App />)