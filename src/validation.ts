import type { ConfigDefinition } from './configDefinitions'
import type { ConfigValues } from './types'

const ip = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const isIp = (value: string) => ip.test(value)
export function validateForm(definition: ConfigDefinition, values: ConfigValues): Record<string, string> {
  const errors: Record<string, string> = {}
  definition.fields.forEach((field) => {
    const value = values[field.key]?.trim() ?? ''
    if (!value) errors[field.key] = 'This field is required.'
    else if (field.key.toLowerCase().includes('ip') || field.key === 'network' || field.key === 'defaultGateway' || field.key === 'nextHop' || field.key === 'dnsServer' || field.key === 'subnetMask' || field.key === 'wildcard') {
      if (!isIp(value)) errors[field.key] = field.key === 'wildcard' ? 'Enter a valid wildcard mask.' : 'Enter a valid IPv4 address.'
    } else if (field.type === 'number' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) errors[field.key] = 'Enter a valid number.'
    else if (field.key === 'vlanId' && (Number(value) < 1 || Number(value) > 4094)) errors[field.key] = 'VLAN ID must be 1–4094.'
  })
  return errors
}