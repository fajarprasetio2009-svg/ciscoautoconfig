export type ConfigType = 'vlan' | 'access-port' | 'trunk' | 'inter-vlan' | 'dhcp' | 'static-routing' | 'ospf' | 'eigrp' | 'bgp' | 'nat' | 'acl' | 'port-security' | 'etherchannel'

export type FieldType = 'text' | 'number' | 'select'
export type FieldDefinition = { key: string; label: string; placeholder: string; type?: FieldType; options?: string[] }
export type ConfigValues = Record<string, string>
export type BridgeStatus = 'READY' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'OFFLINE'
export type BridgeSnapshot = { connected: boolean; status: BridgeStatus; device_code: string; job_id: string | null; commands: string[]; completed: string[]; current_command: string; progress: number }
export type HistoryItem = { id: string; type: ConfigType; name: string; status: 'Successful' | 'Failed' | 'Cancelled'; time: string; commands: string[] }