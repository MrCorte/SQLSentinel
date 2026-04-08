/**
 * Expands a CIDR notation string into an array of all IP addresses in the range.
 * Example: '192.168.1.0/24' → ['192.168.1.0', '192.168.1.1', ..., '192.168.1.255']
 */
export function expandCidr(cidr: string): string[] {
  const [baseIp, prefixStr] = cidr.split('/')
  if (!baseIp || prefixStr === undefined) {
    throw new Error(`Invalid CIDR notation: ${cidr}`)
  }

  const prefix = parseInt(prefixStr, 10)
  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid prefix length in CIDR: ${cidr}`)
  }

  const parts = baseIp.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IP address in CIDR: ${cidr}`)
  }

  // Convert base IP to unsigned 32-bit integer
  const baseInt = (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0)

  const hostCount = Math.pow(2, 32 - prefix)
  if (hostCount > 65536) {
    throw new Error(`CIDR range too large (${hostCount} hosts) — minimum prefix /16`)
  }
  const networkMask = (~(hostCount - 1)) >>> 0
  const networkInt = (baseInt & networkMask) >>> 0

  const ips: string[] = []
  for (let i = 0; i < hostCount; i++) {
    const ipInt = networkInt + i
    const ip = [
      (ipInt >>> 24) & 0xff,
      (ipInt >>> 16) & 0xff,
      (ipInt >>> 8) & 0xff,
      ipInt & 0xff
    ].join('.')
    ips.push(ip)
  }

  return ips
}
