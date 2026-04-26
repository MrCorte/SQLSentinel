# DB Bulk Alias & Owner Edit

**Date:** 2026-04-26
**Status:** Approved

## Problem

Setting alias and owner (referente) on database records is one-at-a-time via a modal dialog. When multiple databases share the same owner, or when owner values repeat across servers, the workflow is slow and repetitive. Autocomplete for known values is missing.

## Goals

- Bulk-set alias and owner across multiple selected databases in one action
- Autocomplete on both the single-edit and bulk-edit dialogs using values already stored in `db_custom_fields`
- Always overwrite: an empty field clears the existing value on all selected databases

## Out of Scope

- Inline cell editing
- Server-level or group-level owner assignment
- Import/export of custom fields

---

## Design

### 1. DB Grid — Checkbox Selection

Add `checkboxSelection` to the MUI X DataGrid in the Databases tab (`MetricsTabs.tsx`). Track selection state via `rowSelectionModel` / `onRowSelectionModelChange`.

- Single row selected (via row click or checkbox): existing `DbEditDialog` opens, unchanged except for autocomplete addition
- 2+ rows selected: bulk toolbar appears above the grid

### 2. Bulk Toolbar

Rendered above the DataGrid when `rowSelectionModel.length >= 2`. Contains:

- Label: `"{N} databases selected"`
- Button: `"✏ Edit fields"` → opens `DbBulkEditDialog`
- Button: `"✕ Clear selection"` → clears `rowSelectionModel`

Toolbar disappears when selection drops to 0 or 1.

### 3. DbBulkEditDialog (new component)

Props:
```ts
interface DbBulkEditDialogProps {
  open: boolean
  dbNames: string[]        // display only
  onClose: () => void
  onSave: (fields: DbCustomFields) => void
  aliasSuggestions: string[]
  ownerSuggestions: string[]
}
```

UI:
- Title: `"Edit {N} databases"`
- Subtitle: list of selected DB names (truncated if >5)
- Alias field: MUI `Autocomplete` (freeSolo) with `aliasSuggestions`
- Owner field: MUI `Autocomplete` (freeSolo) with `ownerSuggestions`
- Info note: `"Values applied to all selected databases. Leave blank to clear."`
- Actions: Cancel | `"Apply to {N} databases"`

**Overwrite behavior:** both fields always overwrite. Empty string → clears existing value. No conditional logic.

### 4. Autocomplete Suggestions

Suggestions are derived client-side from the existing `dbCustomFields` store (already loaded). No new IPC channel needed.

```ts
const aliasSuggestions = useMemo(() =>
  [...new Set(Object.values(dbCustomFields).map(f => f.alias).filter(Boolean))] as string[],
  [dbCustomFields]
)
const ownerSuggestions = useMemo(() =>
  [...new Set(Object.values(dbCustomFields).map(f => f.referente).filter(Boolean))] as string[],
  [dbCustomFields]
)
```

Pass suggestions to both `DbEditDialog` (single) and `DbBulkEditDialog` (bulk).

### 5. Save Flow

**Single edit:** unchanged — calls existing `db.setCustomFields` IPC.

**Bulk edit:** on save, call `db.setCustomFields` for each selected DB in sequence:
```ts
for (const dbName of selectedDbNames) {
  await window.sqlSentinel.db.setCustomFields({ serverId, dbName, fields })
}
```

No new IPC needed. The existing `setCustomFields` handler accepts one DB at a time; N sequential calls are fast (SQLite, local).

### 6. Single-Edit Autocomplete

`DbEditDialog` receives `aliasSuggestions` and `ownerSuggestions` props. The `TextField` components become MUI `Autocomplete` (freeSolo) with the suggestion lists.

---

## Component Map

| File | Change |
|------|--------|
| `src/renderer/src/components/features/metrics/MetricsTabs.tsx` | Add `checkboxSelection`, selection state, bulk toolbar, pass suggestions to dialogs |
| `src/renderer/src/components/features/metrics/DbBulkEditDialog.tsx` | New component |
| `src/renderer/src/components/features/metrics/DbEditDialog` (inline in MetricsTabs) | Add autocomplete props |

---

## Data Flow

```
dbCustomFields store (already loaded)
  → derive aliasSuggestions, ownerSuggestions (useMemo)
  → pass to DbEditDialog (single) + DbBulkEditDialog (bulk)

User selects rows → rowSelectionModel
  → 1 row: DbEditDialog
  → 2+ rows: bulk toolbar → DbBulkEditDialog → setCustomFields × N
```

---

## Edge Cases

- **All fields blank on bulk save:** clears alias + owner on all selected DBs — intentional
- **1 row selected via checkbox:** treat same as row-click edit (open single dialog, not bulk)
- **DataGrid row click vs checkbox:** row click opens single edit; checkbox selection drives bulk mode
