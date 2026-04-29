import { describe, it, expect } from 'vitest'
import { expandCidr } from './cidrUtils'

describe('expandCidr', () => {
  describe('valid ranges', () => {
    it('/32 → exactly 1 IP equal to the base address', () => {
      const ips = expandCidr('192.168.1.5/32')
      expect(ips).toHaveLength(1)
      expect(ips[0]).toBe('192.168.1.5')
    })

    it('/31 → exactly 2 IPs', () => {
      const ips = expandCidr('10.0.0.0/31')
      expect(ips).toHaveLength(2)
      expect(ips[0]).toBe('10.0.0.0')
      expect(ips[1]).toBe('10.0.0.1')
    })

    it('/24 → 256 IPs, first = network, last = broadcast', () => {
      const ips = expandCidr('192.168.1.0/24')
      expect(ips).toHaveLength(256)
      expect(ips[0]).toBe('192.168.1.0')
      expect(ips[255]).toBe('192.168.1.255')
    })

    it('/24 with non-zero host bits → still aligns to network', () => {
      // 192.168.1.100/24 → network is 192.168.1.0
      const ips = expandCidr('192.168.1.100/24')
      expect(ips).toHaveLength(256)
      expect(ips[0]).toBe('192.168.1.0')
    })

    it('/16 → exactly 65536 IPs (boundary maximum allowed)', () => {
      const ips = expandCidr('10.1.0.0/16')
      expect(ips).toHaveLength(65536)
      expect(ips[0]).toBe('10.1.0.0')
      expect(ips[65535]).toBe('10.1.255.255')
    })

    it('IPs in a /30 range are contiguous', () => {
      const ips = expandCidr('10.0.0.0/30')
      expect(ips).toHaveLength(4)
      expect(ips).toEqual(['10.0.0.0', '10.0.0.1', '10.0.0.2', '10.0.0.3'])
    })
  })

  describe('error cases', () => {
    it('prefix /15 (>65536 hosts) → throws with "too large"', () => {
      expect(() => expandCidr('10.0.0.0/15')).toThrow(/too large/i)
    })

    it('prefix /0 → throws', () => {
      expect(() => expandCidr('0.0.0.0/0')).toThrow()
    })

    it('invalid prefix 33 → throws', () => {
      expect(() => expandCidr('192.168.1.0/33')).toThrow(/prefix/i)
    })

    it('non-numeric prefix → throws', () => {
      expect(() => expandCidr('192.168.1.0/abc')).toThrow()
    })

    it('missing slash → throws', () => {
      expect(() => expandCidr('192.168.1.0')).toThrow()
    })

    it('empty string → throws', () => {
      expect(() => expandCidr('')).toThrow()
    })

    it('IP with out-of-range octet → throws', () => {
      expect(() => expandCidr('192.168.256.0/24')).toThrow(/invalid ip/i)
    })

    it('IP with only 3 octets → throws', () => {
      expect(() => expandCidr('192.168.1/24')).toThrow()
    })

    it('negative prefix → throws', () => {
      expect(() => expandCidr('10.0.0.0/-1')).toThrow()
    })
  })
})
