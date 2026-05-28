// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { StorageSetupPage } from '../pages/StorageSetupPage'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('sqlSentinel', {
    storage: {
      getSafeStorageStatus: vi.fn().mockResolvedValue({ ok: true, data: { available: true } }),
      testConnection: vi.fn().mockRejectedValue(new Error('UNAUTHORIZED')),
      saveConfig: vi.fn()
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('StorageSetupPage', () => {
  it('stops the connection-test spinner when the IPC call rejects', async () => {
    render(<StorageSetupPage onConfigured={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'dock' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'Dock@SQLSentinel2025' }
    })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => {
      expect(screen.getByText(/unauthorized/i)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /test connection/i })).toBeTruthy()
  })

  it('times out when the connection-test IPC call never settles', async () => {
    vi.useFakeTimers()
    vi.mocked(window.sqlSentinel.storage.testConnection).mockReturnValue(
      new Promise(() => {}) as ReturnType<typeof window.sqlSentinel.storage.testConnection>
    )

    render(<StorageSetupPage onConfigured={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'dock' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'Dock@SQLSentinel2025' }
    })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })

    expect(screen.getByText(/connection test timed out/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /test connection/i })).toBeTruthy()
  })
})
