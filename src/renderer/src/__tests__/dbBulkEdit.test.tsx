// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMetricsData } from '../components/features/metrics/useMetricsData'

vi.mock('../api/ipc', () => ({
  getAllDbCustomFields: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  setDbCustomFields: vi.fn().mockResolvedValue({ ok: true, data: null }),
  setDbCustomFieldsBulk: vi.fn().mockResolvedValue({ ok: true, data: null })
}))
import * as ipc from '../api/ipc'

const METRICS = {
  instanceInfo: {
    cpuUsagePercent: 10,
    memoryUsedMb: 1000,
    memoryTotalMb: 4000,
    sqlVersion: '15',
    sqlEdition: 'Dev',
    serverName: 'SRV',
    loginMode: 'SQL'
  },
  databases: [
    {
      name: 'Alpha',
      stateDesc: 'ONLINE',
      recoveryModel: 'FULL',
      sizeMb: 100,
      logSizeMb: 10,
      compatibilityLevel: 150
    },
    {
      name: 'Beta',
      stateDesc: 'ONLINE',
      recoveryModel: 'FULL',
      sizeMb: 200,
      logSizeMb: 20,
      compatibilityLevel: 150
    }
  ],
  activeSessions: [],
  backupStatus: [],
  diskVolumes: [],
  waitStats: [],
  topQueries: [],
  databaseFiles: [],
  agGroups: [],
  agReplicas: [],
  agDatabases: []
} as any
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DbBulkEditDialog } from '../components/features/metrics/DbBulkEditDialog'

afterEach(() => cleanup())

const baseProps = {
  open: true,
  dbNames: ['Alpha', 'Beta', 'Gamma'],
  onClose: vi.fn(),
  onSave: vi.fn(),
  aliasSuggestions: ['Alias1', 'Alias2'],
  ownerSuggestions: ['Andrea C.', 'Mario R.'],
  saving: false
}

beforeEach(() => {
  baseProps.onSave.mockClear()
  baseProps.onClose.mockClear()
})

describe('DbBulkEditDialog', () => {
  it('renders title with db count', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    expect(screen.getByText(/Edit 3 databases/i)).toBeTruthy()
  })

  it('truncates subtitle when more than 5 db names', () => {
    render(<DbBulkEditDialog {...baseProps} dbNames={['A', 'B', 'C', 'D', 'E', 'F', 'G']} />)
    expect(screen.getByText(/\+2 more/i)).toBeTruthy()
  })

  it('calls onSave with undefined values after two-step confirm when both fields empty', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    fireEvent.click(screen.getByTestId('apply-btn')) // first click → confirm state
    fireEvent.click(screen.getByTestId('apply-btn')) // second click → fires onSave
    expect(baseProps.onSave).toHaveBeenCalledWith({ alias: undefined, referente: undefined })
  })

  it('calls onSave immediately with trimmed value when alias is filled', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    fireEvent.change(screen.getByTestId('alias-input'), { target: { value: 'MyAlias' } })
    fireEvent.click(screen.getByTestId('apply-btn'))
    expect(baseProps.onSave).toHaveBeenCalledWith({ alias: 'MyAlias', referente: undefined })
  })

  it('disables Apply button when saving=true', () => {
    render(<DbBulkEditDialog {...baseProps} saving={true} />)
    expect((screen.getByTestId('apply-btn') as HTMLButtonElement).disabled).toBe(true)
  })

  it('resets confirm state when alias field is edited after both-empty click', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    fireEvent.click(screen.getByTestId('apply-btn'))
    expect(screen.getByTestId('apply-btn').textContent).toMatch(/Confirm/i)
    fireEvent.change(screen.getByTestId('alias-input'), { target: { value: 'x' } })
    expect(screen.getByTestId('apply-btn').textContent).toMatch(/Apply to 3/i)
  })

  it('resets confirm state when owner field is edited after both-empty click', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    fireEvent.click(screen.getByTestId('apply-btn'))
    expect(screen.getByTestId('apply-btn').textContent).toMatch(/Confirm/i)
    fireEvent.change(screen.getByTestId('owner-input'), { target: { value: 'x' } })
    expect(screen.getByTestId('apply-btn').textContent).toMatch(/Apply to 3/i)
  })
})

describe('useMetricsData — bulk save', () => {
  beforeEach(() => {
    vi.mocked(ipc.setDbCustomFieldsBulk).mockClear()
    vi.mocked(ipc.setDbCustomFieldsBulk).mockResolvedValue({ ok: true, data: null })
    vi.mocked(ipc.getAllDbCustomFields).mockClear()
  })

  it('handleBulkSaveDbFields sends one bulk call with all selected DBs', async () => {
    const { result } = renderHook(() => useMetricsData({ metrics: METRICS, serverId: 'srv1' }))
    await act(async () => {
      result.current.setRowSelectionModel({ type: 'include', ids: new Set(['Alpha', 'Beta']) })
    })
    await act(async () => {
      await result.current.handleBulkSaveDbFields({ alias: 'Bulk', referente: 'Owner' })
    })
    expect(ipc.setDbCustomFieldsBulk).toHaveBeenCalledTimes(1)
    expect(ipc.setDbCustomFieldsBulk).toHaveBeenCalledWith({
      serverId: 'srv1',
      dbNames: ['Alpha', 'Beta'],
      fields: { alias: 'Bulk', referente: 'Owner' }
    })
  })

  it('resets rowSelectionModel after bulk save', async () => {
    const { result } = renderHook(() => useMetricsData({ metrics: METRICS, serverId: 'srv1' }))
    await act(async () => {
      result.current.setRowSelectionModel({ type: 'include', ids: new Set(['Alpha']) })
    })
    await act(async () => {
      await result.current.handleBulkSaveDbFields({ alias: undefined, referente: undefined })
    })
    expect(result.current.rowSelectionModel.ids.size).toBe(0)
  })

  it('sets success snackbar after all saves succeed', async () => {
    const { result } = renderHook(() => useMetricsData({ metrics: METRICS, serverId: 'srv1' }))
    await act(async () => {
      result.current.setRowSelectionModel({ type: 'include', ids: new Set(['Alpha', 'Beta']) })
    })
    await act(async () => {
      await result.current.handleBulkSaveDbFields({ alias: 'X', referente: undefined })
    })
    expect(result.current.snackbar?.severity).toBe('success')
  })

  it('sets error snackbar when the bulk save fails', async () => {
    vi.mocked(ipc.setDbCustomFieldsBulk).mockResolvedValue({ ok: false, error: 'DB error' } as any)
    const { result } = renderHook(() => useMetricsData({ metrics: METRICS, serverId: 'srv1' }))
    await act(async () => {
      result.current.setRowSelectionModel({ type: 'include', ids: new Set(['Alpha', 'Beta']) })
    })
    await act(async () => {
      await result.current.handleBulkSaveDbFields({ alias: 'X', referente: undefined })
    })
    expect(result.current.snackbar?.severity).toBe('error')
    expect(result.current.snackbar?.message).toMatch(/Failed to update/)
  })

  it('reports all selected DBs as failed when the bulk save rejects', async () => {
    vi.mocked(ipc.setDbCustomFieldsBulk).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useMetricsData({ metrics: METRICS, serverId: 'srv1' }))
    await act(async () => {
      result.current.setRowSelectionModel({ type: 'include', ids: new Set(['Alpha', 'Beta']) })
    })
    let ret: { failed: string[] } | undefined
    await act(async () => {
      ret = await result.current.handleBulkSaveDbFields({ alias: 'X', referente: undefined })
    })
    expect(ret?.failed).toEqual(['Alpha', 'Beta'])
    expect(result.current.snackbar?.severity).toBe('error')
  })
})
