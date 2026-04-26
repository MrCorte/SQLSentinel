# DB Bulk Alias & Owner Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multi-select of database rows in the Databases tab and bulk-set alias + owner in one dialog, plus add autocomplete from existing values to both single and bulk edit dialogs.

**Architecture:** State and IPC live in `useMetricsData.ts`; `TabDatabase` in `MetricsTabs.tsx` gets checkbox selection via `onCellClick` guard, a bulk toolbar, and wires both dialogs; `DbBulkEditDialog.tsx` is a new standalone component. New props threaded through `MetricsPanel.tsx`.

**Tech Stack:** React 19, MUI v7, MUI X DataGrid v8.27.5, Vitest + @testing-library/react, TypeScript strict

---

## Critical API Notes

```ts
// MUI X DataGrid v8.27.5 — GridRowSelectionModel is NOT an array
import type { GridRowSelectionModel, GridRowId } from '@mui/x-data-grid'
// GridRowSelectionModel = { type: 'include' | 'exclude'; ids: Set<GridRowId> }

// Empty selection
const EMPTY_SELECTION: GridRowSelectionModel = { type: 'include', ids: new Set() }

// Get count
model.ids.size

// Get string array (db names, since getRowId returns db.name)
Array.from(model.ids) as string[]

// Checkbox column field constant
import { GRID_CHECKBOX_SELECTION_FIELD } from '@mui/x-data-grid'
// GRID_CHECKBOX_SELECTION_FIELD === '__check__'

// DbCustomFields — string | undefined (NOT null)
interface DbCustomFields { alias?: string; referente?: string }
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/src/components/features/metrics/DbBulkEditDialog.tsx` | **Create** | Bulk edit dialog: Autocomplete fields, two-step confirm, saving state |
| `src/renderer/src/components/features/metrics/useMetricsData.ts` | **Modify** | Add `rowSelectionModel`, `handleBulkSaveDbFields`, `snackbar`, suggestions to `MetricsData` interface + hook |
| `src/renderer/src/components/features/metrics/MetricsTabs.tsx` | **Modify** | `TabDatabase`: checkbox, `onCellClick` guard, bulk toolbar, Snackbar, autocomplete on `DbEditDialog` |
| `src/renderer/src/components/MetricsPanel.tsx` | **Modify** | Pass new props from `useMetricsData` to `TabDatabase` |
| `src/renderer/src/__tests__/dbBulkEdit.test.tsx` | **Create** | Unit tests for `DbBulkEditDialog` and bulk save logic |

---

## Task 1: Create `DbBulkEditDialog` component

**Files:**
- Create: `src/renderer/src/components/features/metrics/DbBulkEditDialog.tsx`
- Test: `src/renderer/src/__tests__/dbBulkEdit.test.tsx`

- [ ] **Step 1.1: Write failing tests**

Create `src/renderer/src/__tests__/dbBulkEdit.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
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

describe('DbBulkEditDialog', () => {
  it('renders title with db count', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    expect(screen.getByText(/Edit 3 databases/i)).toBeTruthy()
  })

  it('truncates subtitle when more than 5 db names', () => {
    render(<DbBulkEditDialog {...baseProps} dbNames={['A','B','C','D','E','F','G']} />)
    expect(screen.getByText(/\+2 more/i)).toBeTruthy()
  })

  it('calls onSave with undefined values after two-step confirm when both fields empty', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    fireEvent.click(screen.getByTestId('apply-btn'))             // first click → confirm state
    fireEvent.click(screen.getByTestId('apply-btn'))             // second click → fires onSave
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
})
```

- [ ] **Step 1.2: Run tests — verify they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "dbBulkEdit"
```

Expected: FAIL — component not yet created.

- [ ] **Step 1.3: Create `DbBulkEditDialog.tsx`**

```tsx
import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Autocomplete
} from '@mui/material'

interface DbBulkEditDialogProps {
  open: boolean
  dbNames: string[]
  onClose: () => void
  onSave: (fields: { alias: string | undefined; referente: string | undefined }) => void
  aliasSuggestions: string[]
  ownerSuggestions: string[]
  saving: boolean
}

export function DbBulkEditDialog({
  open,
  dbNames,
  onClose,
  onSave,
  aliasSuggestions,
  ownerSuggestions,
  saving
}: DbBulkEditDialogProps): React.JSX.Element {
  const [alias, setAlias] = useState('')
  const [owner, setOwner] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    if (open) {
      setAlias('')
      setOwner('')
      setConfirmClear(false)
    }
  }, [open])

  const n = dbNames.length
  const subtitle =
    n <= 5
      ? dbNames.join(', ')
      : `${dbNames.slice(0, 5).join(', ')} +${n - 5} more`

  const toValue = (s: string): string | undefined => s.trim() || undefined

  function handleApply(): void {
    const bothEmpty = !alias.trim() && !owner.trim()
    if (bothEmpty && !confirmClear) {
      setConfirmClear(true)
      return
    }
    onSave({ alias: toValue(alias), referente: toValue(owner) })
  }

  function handleAliasChange(value: string): void {
    setAlias(value)
    if (confirmClear) setConfirmClear(false)
  }

  function handleOwnerChange(value: string): void {
    setOwner(value)
    if (confirmClear) setConfirmClear(false)
  }

  const applyLabel = confirmClear
    ? 'Confirm — clear both fields?'
    : `Apply to ${n} database${n !== 1 ? 's' : ''}`

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Edit {n} database{n !== 1 ? 's' : ''}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>

        <Autocomplete
          freeSolo
          options={aliasSuggestions}
          value={alias}
          onInputChange={(_, v) => handleAliasChange(typeof v === 'string' ? v : '')}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Alias"
              size="small"
              fullWidth
              inputProps={{ ...params.inputProps, 'data-testid': 'alias-input' }}
            />
          )}
        />

        <Autocomplete
          freeSolo
          options={ownerSuggestions}
          value={owner}
          onInputChange={(_, v) => handleOwnerChange(typeof v === 'string' ? v : '')}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Owner"
              size="small"
              fullWidth
              inputProps={{ ...params.inputProps, 'data-testid': 'owner-input' }}
            />
          )}
        />

        <Typography variant="caption" color="text.secondary">
          Values applied to all selected databases. Leave blank to clear.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          data-testid="apply-btn"
          variant="contained"
          color={confirmClear ? 'warning' : 'primary'}
          onClick={handleApply}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {applyLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 1.4: Run tests — verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A5 "DbBulkEditDialog"
```

- [ ] **Step 1.5: Commit**

```bash
git add src/renderer/src/components/features/metrics/DbBulkEditDialog.tsx \
        src/renderer/src/__tests__/dbBulkEdit.test.tsx
git commit -m "feat: add DbBulkEditDialog component"
```

---

## Task 2: Extend `useMetricsData` — bulk save + selection state

**Files:**
- Modify: `src/renderer/src/components/features/metrics/useMetricsData.ts`
- Test: `src/renderer/src/__tests__/dbBulkEdit.test.tsx` (extend)

- [ ] **Step 2.1: Write failing tests for bulk save**

Append to `src/renderer/src/__tests__/dbBulkEdit.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react'
import { useMetricsData } from '../components/features/metrics/useMetricsData'

vi.mock('../api/ipc', () => ({
  getAllDbCustomFields: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  setDbCustomFields: vi.fn().mockResolvedValue({ ok: true, data: null })
}))
import * as ipc from '../api/ipc'

const EMPTY_SELECTION = { type: 'include' as const, ids: new Set<import('@mui/x-data-grid').GridRowId>() }

const METRICS = {
  instanceInfo: { cpuUsagePercent: 10, memoryUsedMb: 1000, memoryTotalMb: 4000,
    sqlVersion: '15', sqlEdition: 'Dev', serverName: 'SRV', loginMode: 'SQL' },
  databases: [
    { name: 'Alpha', stateDesc: 'ONLINE', recoveryModel: 'FULL', sizeMb: 100, logSizeMb: 10, compatibilityLevel: 150 },
    { name: 'Beta',  stateDesc: 'ONLINE', recoveryModel: 'FULL', sizeMb: 200, logSizeMb: 20, compatibilityLevel: 150 }
  ],
  activeSessions: [], backupStatus: [], diskVolumes: [], waitStats: [],
  topQueries: [], databaseFiles: [], agGroups: [], agReplicas: [], agDatabases: []
} as any

describe('useMetricsData — bulk save', () => {
  it('handleBulkSaveDbFields calls setDbCustomFields for each selected DB', async () => {
    const { result } = renderHook(() => useMetricsData({ metrics: METRICS, serverId: 'srv1' }))
    await act(async () => {
      result.current.setRowSelectionModel({ type: 'include', ids: new Set(['Alpha', 'Beta']) })
    })
    await act(async () => {
      await result.current.handleBulkSaveDbFields({ alias: 'Bulk', referente: 'Owner' })
    })
    expect(ipc.setDbCustomFields).toHaveBeenCalledWith({
      serverId: 'srv1', dbName: 'Alpha', fields: { alias: 'Bulk', referente: 'Owner' }
    })
    expect(ipc.setDbCustomFields).toHaveBeenCalledWith({
      serverId: 'srv1', dbName: 'Beta', fields: { alias: 'Bulk', referente: 'Owner' }
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
})
```

- [ ] **Step 2.2: Run test — verify it fails**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "bulk save"
```

- [ ] **Step 2.3: Rewrite `useMetricsData.ts`**

Replace full file contents:

```ts
import { useState, useEffect, useCallback, useMemo } from 'react'
import * as ipc from '../../../api/ipc'
import type {
  ServerMetrics,
  DatabaseInfo,
  DbCustomFields,
  QueryInfo
} from '../../../../../preload/index'
import type { GridRowSelectionModel } from '@mui/x-data-grid'
import { createLogger } from '../../../utils/logger'

export type QueryRow = QueryInfo & { _rowId: string }

const log = createLogger('metrics-panel')

const EMPTY_SELECTION: GridRowSelectionModel = { type: 'include', ids: new Set() }

interface UseMetricsDataParams {
  metrics: ServerMetrics
  serverId: string
}

export interface MetricsData {
  tab: number
  setTab: (v: number) => void

  databases: DatabaseInfo[]
  customFields: Record<string, DbCustomFields>
  editingDb: DatabaseInfo | null
  setEditingDb: (db: DatabaseInfo | null) => void
  handleSaveDbFields: (fields: DbCustomFields) => Promise<void>

  rowSelectionModel: GridRowSelectionModel
  setRowSelectionModel: (model: GridRowSelectionModel) => void
  handleBulkSaveDbFields: (
    fields: { alias: string | undefined; referente: string | undefined }
  ) => Promise<{ failed: string[] }>

  aliasSuggestions: string[]
  ownerSuggestions: string[]

  snackbar: { message: string; severity: 'success' | 'error' } | null
  setSnackbar: (s: { message: string; severity: 'success' | 'error' } | null) => void

  topQueriesRows: QueryRow[]
}

export function useMetricsData({ metrics, serverId }: UseMetricsDataParams): MetricsData {
  const [tab, setTab] = useState(0)
  const [customFields, setCustomFields] = useState<Record<string, DbCustomFields>>({})
  const [editingDb, setEditingDb] = useState<DatabaseInfo | null>(null)
  const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>(EMPTY_SELECTION)
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null)

  useEffect(() => {
    ipc
      .getAllDbCustomFields()
      .then((r) => {
        if (r.ok) setCustomFields(r.data)
        else log.error('getAllDbCustomFields error:', r.error)
      })
      .catch((err) => log.error('getAllDbCustomFields threw:', err))
  }, [])

  const databases: DatabaseInfo[] = useMemo(
    () =>
      (metrics.databases ?? []).map((db) => {
        const cf = customFields[`${serverId}/${db.name}`]
        return { ...db, alias: cf?.alias ?? db.alias, referente: cf?.referente ?? db.referente }
      }),
    [metrics.databases, customFields, serverId]
  )

  // Suggestions drawn from all stored custom fields (cross-server, deduplicated)
  const aliasSuggestions = useMemo(
    () =>
      [...new Set(Object.values(customFields).map((f) => f.alias).filter((v): v is string => !!v))],
    [customFields]
  )

  const ownerSuggestions = useMemo(
    () =>
      [...new Set(Object.values(customFields).map((f) => f.referente).filter((v): v is string => !!v))],
    [customFields]
  )

  const handleSaveDbFields = useCallback(
    async (fields: DbCustomFields) => {
      if (!editingDb) return
      const result = await ipc.setDbCustomFields({ serverId, dbName: editingDb.name, fields })
      if (result.ok) {
        setCustomFields((prev) => ({ ...prev, [`${serverId}/${editingDb.name}`]: fields }))
        setEditingDb(null)
      }
    },
    [editingDb, serverId]
  )

  const handleBulkSaveDbFields = useCallback(
    async (
      fields: { alias: string | undefined; referente: string | undefined }
    ): Promise<{ failed: string[] }> => {
      // GridRowSelectionModel.ids is Set<GridRowId>; cast to string[] since getRowId returns db.name
      const selectedNames = Array.from(rowSelectionModel.ids) as string[]
      const dbFields: DbCustomFields = { alias: fields.alias, referente: fields.referente }

      const results = await Promise.allSettled(
        selectedNames.map((dbName) => ipc.setDbCustomFields({ serverId, dbName, fields: dbFields }))
      )

      const failed = selectedNames.filter((_, i) => {
        const r = results[i]
        return r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
      })
      const succeeded = selectedNames.filter((_, i) => {
        const r = results[i]
        return r.status === 'fulfilled' && r.value.ok
      })

      if (succeeded.length > 0) {
        setCustomFields((prev) => {
          const next = { ...prev }
          for (const dbName of succeeded) next[`${serverId}/${dbName}`] = dbFields
          return next
        })
      }

      setRowSelectionModel(EMPTY_SELECTION)

      if (failed.length === 0) {
        setSnackbar({
          message: `${selectedNames.length} database${selectedNames.length !== 1 ? 's' : ''} updated`,
          severity: 'success'
        })
      } else {
        setSnackbar({ message: `Failed to update: ${failed.join(', ')}`, severity: 'error' })
      }
      return { failed }
    },
    [rowSelectionModel, serverId]
  )

  const topQueriesRows: QueryRow[] = useMemo(() => {
    const seen = new Map<string, number>()
    return (metrics.topQueries ?? []).map((q) => {
      const n = (seen.get(q.queryText) ?? 0) + 1
      seen.set(q.queryText, n)
      return { ...q, _rowId: n === 1 ? q.queryText : `${q.queryText}#${n}` }
    })
  }, [metrics.topQueries])

  return {
    tab, setTab,
    databases, customFields, editingDb, setEditingDb, handleSaveDbFields,
    rowSelectionModel, setRowSelectionModel, handleBulkSaveDbFields,
    aliasSuggestions, ownerSuggestions,
    snackbar, setSnackbar,
    topQueriesRows
  }
}
```

- [ ] **Step 2.4: Run tests — verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A5 "bulk save"
```

- [ ] **Step 2.5: Typecheck**

```bash
npm run typecheck 2>&1 | tail -10
```

- [ ] **Step 2.6: Commit**

```bash
git add src/renderer/src/components/features/metrics/useMetricsData.ts \
        src/renderer/src/__tests__/dbBulkEdit.test.tsx
git commit -m "feat: add bulk save, row selection, suggestions to useMetricsData"
```

---

## Task 3: Update `TabDatabase` — checkbox + bulk toolbar + Snackbar

**Files:**
- Modify: `src/renderer/src/components/features/metrics/MetricsTabs.tsx`

- [ ] **Step 3.1: Add imports to `MetricsTabs.tsx`**

Add to the MUI import block:
```ts
import {
  // ...existing...
  Snackbar,
  Alert,
  Autocomplete
} from '@mui/material'
```

Add to the DataGrid import:
```ts
import type { GridColDef, GridCellParams } from '@mui/x-data-grid'
import { GRID_CHECKBOX_SELECTION_FIELD } from '@mui/x-data-grid'
```

Add component import:
```ts
import { DbBulkEditDialog } from './DbBulkEditDialog'
```

- [ ] **Step 3.2: Update `TabDatabase` props type**

Replace the props type block with:

```ts
{
  databases: DatabaseInfo[]
  editingDb: DatabaseInfo | null
  setEditingDb: (db: DatabaseInfo | null) => void
  handleSaveDbFields: MetricsData['handleSaveDbFields']
  rowSelectionModel: MetricsData['rowSelectionModel']
  setRowSelectionModel: MetricsData['setRowSelectionModel']
  handleBulkSaveDbFields: MetricsData['handleBulkSaveDbFields']
  aliasSuggestions: MetricsData['aliasSuggestions']
  ownerSuggestions: MetricsData['ownerSuggestions']
  snackbar: MetricsData['snackbar']
  setSnackbar: MetricsData['setSnackbar']
}
```

- [ ] **Step 3.3: Add local state at top of `TabDatabase` body**

```ts
const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
const [saving, setSaving] = useState(false)
// GridRowSelectionModel.ids is Set<GridRowId> — cast safe since getRowId returns db.name (string)
const selectedNames = Array.from(rowSelectionModel.ids) as string[]
const selectionCount = rowSelectionModel.ids.size
```

- [ ] **Step 3.4: Replace DataGrid with checkbox + `onCellClick`**

```tsx
<DataGrid<DatabaseInfo>
  rows={databases}
  columns={columns}
  getRowId={(r) => r.name}
  density="compact"
  rowHeight={44}
  autoHeight
  checkboxSelection
  disableRowSelectionOnClick
  rowSelectionModel={rowSelectionModel}
  onRowSelectionModelChange={setRowSelectionModel}
  onCellClick={(params: GridCellParams) => {
    if (params.field === GRID_CHECKBOX_SELECTION_FIELD) return
    setEditingDb(params.row as DatabaseInfo)
  }}
  pageSizeOptions={[25, 50]}
  initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
  getRowClassName={(p) => dbRowClass(p.row as DatabaseInfo)}
  sx={DB_SX}
/>
```

- [ ] **Step 3.5: Add bulk toolbar + dialogs to return**

Wrap the entire return in a fragment. Before the DataGrid:

```tsx
{selectionCount >= 1 && (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, bgcolor: 'primary.dark', borderRadius: 1, mb: 0.5 }}>
    <Typography variant="caption" sx={{ color: 'primary.contrastText', fontWeight: 600 }}>
      {selectionCount} database{selectionCount !== 1 ? 's' : ''} selected
    </Typography>
    <Box sx={{ flex: 1 }} />
    <Button size="small" variant="contained" onClick={() => setBulkDialogOpen(true)}>
      ✏ Edit fields
    </Button>
    <Button size="small" variant="text" sx={{ color: 'primary.contrastText' }} onClick={() => setRowSelectionModel({ type: 'include', ids: new Set() })}>
      ✕ Clear
    </Button>
  </Box>
)}
```

After the existing `{editingDb && <DbEditDialog .../>}`:

```tsx
<DbBulkEditDialog
  open={bulkDialogOpen}
  dbNames={selectedNames}
  onClose={() => setBulkDialogOpen(false)}
  onSave={async (fields) => {
    setSaving(true)
    await handleBulkSaveDbFields(fields)
    setSaving(false)
    setBulkDialogOpen(false)
  }}
  aliasSuggestions={aliasSuggestions}
  ownerSuggestions={ownerSuggestions}
  saving={saving}
/>
<Snackbar
  open={snackbar !== null}
  autoHideDuration={4000}
  onClose={() => setSnackbar(null)}
  anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
>
  <Alert severity={snackbar?.severity ?? 'success'} onClose={() => setSnackbar(null)} sx={{ width: '100%' }}>
    {snackbar?.message}
  </Alert>
</Snackbar>
```

- [ ] **Step 3.6: Typecheck**

```bash
npm run typecheck 2>&1 | tail -15
```

Fix any errors before continuing.

- [ ] **Step 3.7: Commit**

```bash
git add src/renderer/src/components/features/metrics/MetricsTabs.tsx
git commit -m "feat: add checkbox selection, bulk toolbar, and Snackbar to TabDatabase"
```

---

## Task 4: Update `MetricsPanel.tsx` — pass new props to `TabDatabase`

**Files:**
- Modify: `src/renderer/src/components/MetricsPanel.tsx`

- [ ] **Step 4.1: Destructure new fields from `useMetricsData`**

Find the `useMetricsData` destructure (around line 33). Add the new fields:

```ts
const {
  tab, setTab,
  databases, customFields, editingDb, setEditingDb, handleSaveDbFields,
  rowSelectionModel, setRowSelectionModel, handleBulkSaveDbFields,
  aliasSuggestions, ownerSuggestions,
  snackbar, setSnackbar,
  topQueriesRows
} = useMetricsData({ metrics, serverId })
```

- [ ] **Step 4.2: Pass new props to `<TabDatabase>`**

Find the `<TabDatabase>` JSX (around line 87) and add all new props:

```tsx
<TabDatabase
  databases={databases}
  editingDb={editingDb}
  setEditingDb={setEditingDb}
  handleSaveDbFields={handleSaveDbFields}
  rowSelectionModel={rowSelectionModel}
  setRowSelectionModel={setRowSelectionModel}
  handleBulkSaveDbFields={handleBulkSaveDbFields}
  aliasSuggestions={aliasSuggestions}
  ownerSuggestions={ownerSuggestions}
  snackbar={snackbar}
  setSnackbar={setSnackbar}
/>
```

- [ ] **Step 4.3: Typecheck + full test run**

```bash
npm run typecheck 2>&1 | tail -10
npm test 2>&1 | tail -20
```

Expected: no errors, all tests pass.

- [ ] **Step 4.4: Commit**

```bash
git add src/renderer/src/components/MetricsPanel.tsx
git commit -m "feat: thread bulk edit props through MetricsPanel to TabDatabase"
```

---

## Task 5: Add autocomplete to `DbEditDialog` (single edit)

**Files:**
- Modify: `src/renderer/src/components/features/metrics/MetricsTabs.tsx` (inline `DbEditDialog`)

- [ ] **Step 5.1: Extend `DbEditDialogProps`**

```ts
interface DbEditDialogProps {
  open: boolean
  dbName: string
  initial: DbCustomFields
  onClose: () => void
  onSave: (fields: DbCustomFields) => void
  aliasSuggestions: string[]
  ownerSuggestions: string[]
}
```

- [ ] **Step 5.2: Replace TextFields with Autocomplete**

```tsx
<Autocomplete
  freeSolo
  options={aliasSuggestions}
  value={alias}
  onInputChange={(_, v) => setAlias(typeof v === 'string' ? v : '')}
  renderInput={(params) => (
    <TextField {...params} label="Alias" placeholder="Alternative name (optional)" size="small" fullWidth />
  )}
/>
<Autocomplete
  freeSolo
  options={ownerSuggestions}
  value={referente}
  onInputChange={(_, v) => setReferente(typeof v === 'string' ? v : '')}
  renderInput={(params) => (
    <TextField {...params} label="Owner" placeholder="Responsible person (optional)" size="small" fullWidth />
  )}
/>
```

- [ ] **Step 5.3: Pass suggestion props at `DbEditDialog` usage site**

```tsx
{editingDb && (
  <DbEditDialog
    open
    dbName={editingDb.name}
    initial={{ alias: editingDb.alias, referente: editingDb.referente }}
    onClose={() => setEditingDb(null)}
    onSave={handleSaveDbFields}
    aliasSuggestions={aliasSuggestions}
    ownerSuggestions={ownerSuggestions}
  />
)}
```

- [ ] **Step 5.4: Typecheck + full test run**

```bash
npm run typecheck 2>&1 | tail -10
npm test 2>&1 | tail -20
```

- [ ] **Step 5.5: Commit**

```bash
git add src/renderer/src/components/features/metrics/MetricsTabs.tsx
git commit -m "feat: add autocomplete suggestions to single-edit DbEditDialog"
```

---

## Task 6: Manual smoke test

- [ ] **Step 6.1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 6.2: Single edit autocomplete**
  - Databases tab → click any row body → edit dialog opens
  - Type in Alias → existing values appear as suggestions
  - Save → grid shows updated value

- [ ] **Step 6.3: Checkbox + toolbar**
  - Check 2+ database rows → blue toolbar appears with correct count
  - "✕ Clear" → toolbar disappears, checkboxes cleared
  - Row body click while checkboxes checked → single edit opens, checkboxes unaffected

- [ ] **Step 6.4: Bulk edit**
  - Check 3 databases → "✏ Edit fields" → dialog shows count + names
  - Fill Owner only → "Apply to 3 databases" → success snackbar, grid updated
  - Check 2 → Edit → leave both blank → Apply → button becomes "Confirm — clear both fields?" → click again → values cleared

- [ ] **Step 6.5: Commit any fixups**

```bash
git add -p
git commit -m "fix: bulk edit smoke test fixups"
```
