/**
 * Unit tests for resolveRemediationConnection — the credential-selection
 * primitive that ensures approved fixes execute under the *elevated* remediation
 * login and never silently fall back to the read-only monitoring credential.
 */
import { describe, it, expect, vi } from 'vitest'

// resolveRemediationConnection only touches decrypt() as a fallback; we pass an
// already-decrypted remediationPassword so the real safeStorage is never hit.
vi.mock('../../../utils/safeStorageUtil', () => ({
  encrypt: (v: string) => v,
  decrypt: (v: string) => v,
  isAvailable: () => true,
  isEncrypted: () => false
}))

// getPool is imported at module load; stub it so importing serverRepository
// doesn't try to open a real connection.
vi.mock('../connection', () => ({ getPool: vi.fn() }))

import { resolveRemediationConnection } from '../serverRepository'
import type { StoredServer } from '../serverRepository'

function server(extra: Partial<StoredServer>): StoredServer {
  return {
    id: 'srv-1',
    host: '10.0.0.1',
    port: 1433,
    useWindowsAuth: false,
    addedAt: new Date().toISOString(),
    ...extra
  }
}

describe('resolveRemediationConnection', () => {
  it('returns null when no remediation credential is configured', () => {
    expect(resolveRemediationConnection(server({}))).toBeNull()
  })

  it('returns null for SQL auth missing a password', () => {
    expect(resolveRemediationConnection(server({ remediationUsername: 'svc_fix' }))).toBeNull()
  })

  it('builds a SQL-auth connection from the remediation credential', () => {
    const conn = resolveRemediationConnection(
      server({ remediationUsername: 'svc_fix', remediationPassword: 'p@ss' })
    )
    expect(conn).not.toBeNull()
    expect(conn).toMatchObject({
      ip: '10.0.0.1',
      port: 1433,
      username: 'svc_fix',
      password: 'p@ss',
      useWindowsAuth: false,
      encrypt: true
    })
  })

  it('allows Windows-auth remediation without an explicit username/password', () => {
    const conn = resolveRemediationConnection(server({ remediationUseWindowsAuth: true }))
    expect(conn).not.toBeNull()
    expect(conn?.useWindowsAuth).toBe(true)
  })

  it('decrypts the stored password when only the encrypted blob is present', () => {
    const conn = resolveRemediationConnection(
      server({ remediationUsername: 'svc_fix', remediationEncryptedPassword: 'enc-blob' })
    )
    // decrypt() is mocked as identity, so the blob passes straight through.
    expect(conn?.password).toBe('enc-blob')
  })
})
