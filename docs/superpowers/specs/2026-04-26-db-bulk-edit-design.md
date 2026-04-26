# DB Bulk Alias & Owner Edit

**Date:** 2026-04-26
**Status:** Approved

## Problem

Setting alias and owner (`referente`) on database records is one-at-a-time via a modal dialog. When multiple databases share the same owner, or when owner values repeat across servers, the workflow is slow and repetitive. Autocomplete for known values is missing.

> **Glossary:** "owner" in UI labels = `referente` in IPC/store. Same field.

## Goals

- Bulk-set alias and owner across multiple selected databases in one action
- Autocomplete on both single-edit and bulk-edit dialogs using values already in `db_custom_fields`
- Always overwrite: empty field clears the existing value on all selected databases

## Out of Scope

Inline cell editing, server-level assignment, import/export, undo/rollback.

---

## Stack Notes

MUI v5 + MUI X DataGrid v8. Autocomplete option arrays are plain `string[]` — `onChange` handler uses `typeof v === 'string' ? v : ''` safely.

---

## Design

### 1. DB Grid — Checkbox Selection

Add `checkboxSelection` and `disableRowSelectionOnClick` to DataGrid. Fully controlled via `rowSelectionModel` (state) + `onRowSelectionModelChange` (setter). Both props required — without the handler, `"✕ Clear"` will not visually deselect.

Row interactions:
- **Row click (body):** wired via `onRowClick`. Guard against checkbox column: `if (params.field === '__check__') return`. Opens `DbEditDialog` for that single DB.
- **Checkbox click:** toggles `rowSelectionModel`. No dialog.
- **Bulk toolbar:** sibling `Box` above DataGrid (not in DataGrid `Toolbar` slot). **Unmounted** (not hidden) when `rowSelectionModel.length === 0` — no layout space reserved.

### 2. Bulk Toolbar

`Box` rendered as sibling above DataGrid, conditionally mounted when `rowSelectionModel.length >= 1`.

- `"{N} database selected"` / `"{N} databases selected"`
- `"✏ Edit fields"` → opens `DbBulkEditDialog`
- `"✕ Clear"` → `setRowSelectionModel([])`

### 3. DbBulkEditDialog (new file: `DbBulkEditDialog.tsx`)

```ts
interface DbBulkEditDialogProps {
  open: boolean
  dbNames: string[]          // raw DB names (db_name field), used for display + as key in save loop
  onClose: () => void
  onSave: (fields: { alias: string | null; referente: string | null }) => void
  aliasSuggestions: string[]
  ownerSuggestions: string[]
  saving: boolean
}
```

UI:
- Title: `"Edit {N} databases"`
- Subtitle: first 5 of `dbNames` comma-joined; if `dbNames.length > 5`: `"DB1, DB2, DB3, DB4, DB5 +{N-5} more"` where names are raw `db_name` values
- Alias + Owner: MUI `Autocomplete` freeSolo, controlled as `string` (never `null`). `onChange: (_, v) => setField(typeof v === 'string' ? v : '')`
- Info note (always): `"Values applied to all selected databases. Leave blank to clear."`
- Warning state: triggered when Apply clicked with both fields empty. Button label becomes `"Confirm — clear both fields?"`. Any change event on either field (including deleting back to empty) resets the label to `"Apply to {N} databases"`. Second click of the confirm label fires `onSave`.
- One field empty: no warning — intentional
- Apply button: disabled + CircularProgress when `saving === true`. Cancel always enabled.
- `saving = true` is set by parent before calling `onSave`; dialog re-open during an in-flight save is prevented by keeping the dialog closed until the Promise settles.

Payload normalisation (inside dialog before `onSave` call):
```ts
const toValue = (s: string): string | null => s.trim() || null
onSave({ alias: toValue(aliasInput), referente: toValue(ownerInput) })
```

### 4. Autocomplete Suggestions

Derived in `MetricsTabs.tsx` via `useMemo`. Dependency array: `[dbCustomFields]` where `dbCustomFields` is the `Record<string, { alias?: string; referente?: string }>` object from Zustand store (`getAllCustomFields` result).

```ts
const aliasSuggestions = useMemo(() =>
  [...new Set(Object.values(dbCustomFields).map(f => f.alias).filter((v): v is string => !!v))],
  [dbCustomFields]
)
const ownerSuggestions = useMemo(() =>
  [...new Set(Object.values(dbCustomFields).map(f => f.referente).filter((v): v is string => !!v))],
  [dbCustomFields]
)
```

Falls back to `[]` when store is empty — degrades to plain text input. Passed to both `DbEditDialog` and `DbBulkEditDialog`.

### 5. Save Flow

**IPC ownership:** `MetricsTabs.tsx` owns all IPC calls. Dialog `onSave` emits the payload; parent drives IPC.

**Existing `setCustomFields` IPC signature:** `window.sqlSentinel.db.setCustomFields({ serverId: string, dbName: string, fields: { alias: string | null, referente: string | null } }) → Promise<IpcResult<null>>`

**Single edit:** unchanged. Parent calls `setCustomFields` once. No snackbar change needed — follows existing pattern.

**Bulk edit:**
```ts
async function handleBulkSave(fields: { alias: string | null; referente: string | null }) {
  setSaving(true)
  const results = await Promise.allSettled(
    selectedDbNames.map(dbName =>
      window.sqlSentinel.db.setCustomFields({ serverId, dbName, fields })
    )
  )
  const failed = selectedDbNames.filter((_, i) => {
    const r = results[i]
    return r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
  })
  setSaving(false)
  setBulkDialogOpen(false)
  setRowSelectionModel([])
  if (failed.length === 0) showSuccess(`${selectedDbNames.length} databases updated`)
  else showError(`Failed to update: ${failed.join(', ')}`)
}
```

`Promise.allSettled` (parallel) is safe — `setCustomFields` writes to local SQLite, no mssql pool involved. Snackbar severity, duration, and positioning follow the existing project snackbar pattern.

### 6. Single-Edit Autocomplete

`DbEditDialog` (defined inline in `MetricsTabs.tsx`, no extraction in this scope) receives two new props: `aliasSuggestions: string[]` and `ownerSuggestions: string[]`. `TextField` components become `Autocomplete` freeSolo using the same controlled-string pattern.

---

## Component Map

| File | Change |
|------|--------|
| `MetricsTabs.tsx` | `checkboxSelection`, `disableRowSelectionOnClick`, controlled `rowSelectionModel`, `onRowClick` with `__check__` guard, bulk toolbar (unmount when 0), `handleBulkSave`, `saving` state, snackbar, reset selection on save |
| `DbBulkEditDialog.tsx` (new) | Bulk edit dialog |
| `DbEditDialog` (inline in `MetricsTabs.tsx`) | Add autocomplete props; no extraction |

---

## Data Flow

```
dbCustomFields Zustand (Record<string, {alias?, referente?}>)
  → useMemo [dbCustomFields] → aliasSuggestions, ownerSuggestions
  → DbEditDialog (single) + DbBulkEditDialog (bulk)

rowSelectionModel (controlled)
  >= 1 → toolbar mounted
  → "Edit fields" → DbBulkEditDialog (saving prop from parent)
    → onSave({alias|null, referente|null})
    → parent: Promise.allSettled(setCustomFields × N)
    → snackbar + setRowSelectionModel([])

onRowClick (guard: skip __check__ column) → DbEditDialog (single)
```

---

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Both fields empty at Apply | Two-step: button → "Confirm — clear both fields?"; any field change resets label |
| One field empty | Clears that field on all selected DBs, no warning |
| 1 checkbox checked | Toolbar mounts; `onRowClick` still opens single dialog independently |
| Store empty | `[]` suggestions; Autocomplete works as plain text |
| All N calls succeed | Success snackbar: `"{N} databases updated"` |
| Some calls fail | Error snackbar: `"Failed to update: DB1, DB3"` |
| All calls fail | Same error snackbar pattern with all names listed |
| Dialog Cancel during save | Cancel enabled; parent `finally` resets `saving`, closes dialog, clears selection |
| Re-open during in-flight save | Prevented: dialog stays closed until Promise settles |
