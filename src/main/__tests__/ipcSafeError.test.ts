import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../authService', () => ({
  isAuthenticated: vi.fn(() => false),
  isMustChangePassword: vi.fn(() => false)
}))

import { safeError } from '../ipc/handleWrapper'

describe('safeError', () => {
  it('returns message for Error instances', () => {
    expect(safeError(new Error('boom'))).toBe('boom')
  })

  it('returns string as-is', () => {
    expect(safeError('plain error')).toBe('plain error')
  })

  it('converts number to string', () => {
    expect(safeError(42)).toBe('42')
  })

  it('converts null to "null"', () => {
    expect(safeError(null)).toBe('null')
  })

  it('converts undefined to "undefined"', () => {
    expect(safeError(undefined)).toBe('undefined')
  })

  it('converts object to its string representation', () => {
    expect(safeError({ code: 'ERR_001' })).toBe('[object Object]')
  })
})
