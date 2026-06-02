import { describe, it, expect, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn()
}))

const authMocks = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  isMustChangePassword: vi.fn(() => false)
}))

const storageMocks = vi.hoisted(() => ({
  getStorageConfig: vi.fn(() => ({ host: 'db' }))
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  ipcMain: { handle: electronMocks.handle }
}))
vi.mock('../authService', () => ({
  isAuthenticated: authMocks.isAuthenticated,
  isMustChangePassword: authMocks.isMustChangePassword
}))
vi.mock('../store/storageConfig', () => ({
  getStorageConfig: storageMocks.getStorageConfig
}))

import { handle, safeError } from '../ipc/handleWrapper'
import { IpcChannel } from '../ipc/types'

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

describe('handle auth gate', () => {
  it('blocks non-exempt IPC channels when the session must change password', async () => {
    electronMocks.handle.mockClear()
    authMocks.isAuthenticated.mockReturnValue(true)
    authMocks.isMustChangePassword.mockReturnValue(true)

    handle(IpcChannel.SERVERS_GET_ALL, async () => [])
    const listener = electronMocks.handle.mock.calls[0][1]

    await expect(listener({})).rejects.toThrow('MUST_CHANGE_PASSWORD')
  })
})
