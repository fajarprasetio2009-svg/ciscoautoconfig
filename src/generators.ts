import type { ConfigType, ConfigValues } from './types'

export function generateCommands(type: ConfigType, values: ConfigValues): string[] {
  const v = values
  const base = ['enable', 'configure terminal']
  switch (type) {
    case 'vlan': return [...base, `vlan ${v.vlanId}`, `name ${v.vlanName}`, 'end']
    case 'access-port': return [...base, `interface ${v.interface}`, 'switchport mode access', `switchport access vlan ${v.vlanId}`, 'end']
    case 'trunk': return [...base, `interface ${v.interface}`, 'switchport mode trunk', `switchport trunk allowed vlan ${v.allowedVlan}`, 'end']
    case 'inter-vlan': return [...base, `interface ${v.interface}`, `encapsulation dot1Q ${v.vlanId}`, `ip address ${v.ipAddress} ${v.subnetMask}`, 'no shutdown', 'end']
    case 'dhcp': return [...base, `ip dhcp pool ${v.poolName}`, `network ${v.network} ${v.subnetMask}`, `default-router ${v.defaultGateway}`, `dns-server ${v.dnsServer}`, 'end']
    case 'static-routing': return [...base, `ip route ${v.network} ${v.subnetMask} ${v.nextHop}`, 'end']
    case 'ospf': return [...base, `router ospf ${v.processId}`, `network ${v.network} ${v.wildcard} area ${v.area}`, 'end']
    case 'eigrp': return [...base, `router eigrp ${v.asNumber}`, `network ${v.network} ${v.wildcard}`, 'no auto-summary', 'end']
    case 'bgp': return [...base, `router bgp ${v.localAs}`, `neighbor ${v.neighborIp} remote-as ${v.neighborAs}`, 'end']
    case 'nat': return [...base, v.natType === 'PAT' ? 'ip nat inside source list 1 interface GigabitEthernet0/0 overload' : v.natType === 'Static NAT' ? 'ip nat inside source static 192.168.1.10 203.0.113.10' : 'ip nat pool PUBLIC_POOL 203.0.113.10 203.0.113.20 netmask 255.255.255.0', 'end']
    case 'acl': return [...base, v.aclType === 'Standard ACL' ? 'access-list 10 permit 192.168.1.0 0.0.0.255' : 'access-list 101 permit ip any any', 'end']
    case 'port-security': return [...base, `interface ${v.interface}`, 'switchport mode access', 'switchport port-security', `switchport port-security maximum ${v.maximumMac}`, `switchport port-security violation ${v.violationMode}`, 'end']
    case 'etherchannel': return [...base, `interface range ${v.interfaceRange}`, `channel-group ${v.channelGroup} mode ${v.mode}`, 'end']
  }
}