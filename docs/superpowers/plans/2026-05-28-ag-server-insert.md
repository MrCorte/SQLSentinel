# AG Server Insert Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect AG membership (standalone/primary/secondary) during test connection, show it as a badge in the dialog, persist it immediately on save, inherit source-server credentials when suggesting missing replicas, and surface the suggestion dialog from the app root regardless of active page.

**Architecture:** Extend `detectServerInfo()` in the collector to run an AG query in parallel with the SERVERPROPERTY query; thread the result through the IPC type chain into `AddServerFormData`; persist on save so the DB has the role immediately without waiting for background detection. Move `AgReplicaSuggestionDialog` to App root and wire credential inheritance into `AgReplicaSuggestion`.

**Tech Stack:** mssql v12 (tedious), TypeScript strict, React 19, Zustand, MUI v5, Electron IPC.

---

## File Map

| File | Change |
|------|--------|
| `src/main/collectors/types.ts` | Add `agRole?`, `agName?`, `agGroupId?` to `ServerInfo` |
| `src/preload/index.d.ts` | Mirror same extension on `ServerInfo` |
| `src/main/collectors/sqlCollector.ts` | Run AG query in parallel inside `detectServerInfo()` |
| `src/renderer/src/components/AddServerDialog.tsx` | AG badge UI, new form fields, new initial props |
| `src/renderer/src/pages/Discovery.tsx` | Pass AG fields to `addServer`, remove `AgReplicaSuggestionDialog` |
| `src/renderer/src/store/agStore.ts` | Add `sourceCredentials` to `AgReplicaSuggestion` |
| `src/renderer/src/components/AgReplicaSuggestionDialog.tsx` | Pass credentials to inner `AddServerDialog` |
| `src/renderer/src/App.tsx` | Add `<AgReplicaSuggestionDialog />` at root |

---

## Task 1: Extend `ServerInfo` type

**Files:**
- Modify: `src/main/collectors/types.ts:15-18`
- Modify: `src/preload/index.d.ts:49-52`

- [ ] **Step 1: Update `src/main/collectors/types.ts`**

Replace:
```ts
export interface ServerInfo {
  machineName: string
  instanceName: string | null
}
```
With:
```ts
export interface ServerInfo {
  machineName: string
  instanceName: string | null
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  agName?: string
  agGroupId?: string
}
```

- [ ] **Step 2: Mirror in `src/preload/index.d.ts`**

Replace:
```ts
export interface ServerInfo {
  machineName: string
  instanceName: string | null
}
```
With:
```ts
export interface ServerInfo {
  machineName: string
  instanceName: string | null
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  agName?: string
  agGroupId?: string
}
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```
git add src/main/collectors/types.ts src/preload/index.d.ts
git commit -m "feat(ag): extend ServerInfo with agRole/agName/agGroupId"
```

---

## Task 2: Extend `detectServerInfo()` with AG query

**Files:**
- Modify: `src/main/collectors/sqlCollector.ts:581-602`

- [ ] **Step 1: Replace the function body**

Replace the entire `detectServerInfo` function:
```ts
export async function detectServerInfo(connection: ServerConnection): Promise<ServerInfo> {
  const config = buildConfig(connection)
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(config)
    const [serverRes, agRes] = await Promise.allSettled([
      pool.request().query<{ machine_name: string; instance_name: string | null }>(`
        SELECT
          CAST(SERVERPROPERTY('MachineName')  AS NVARCHAR(128)) AS machine_name,
          CAST(SERVERPROPERTY('InstanceName') AS NVARCHAR(128)) AS instance_name
      `),
      pool.request().query<{ ag_name: string; group_id: string; role_desc: string }>(`
        SELECT TOP 1
          ag.name                              AS ag_name,
          CAST(ag.group_id AS NVARCHAR(36))    AS group_id,
          ISNULL(ars.role_desc, 'RESOLVING')   AS role_desc
        FROM sys.availability_groups ag
        JOIN sys.availability_replicas ar
          ON ag.group_id = ar.group_id
        LEFT JOIN sys.dm_hadr_availability_replica_states ars
          ON ar.replica_id = ars.replica_id
        WHERE ars.is_local = 1
      `)
    ])

    const row =
      serverRes.status === 'fulfilled' ? serverRes.value.recordset[0] : undefined
    const agRow =
      agRes.status === 'fulfilled' ? agRes.value.recordset[0] : undefined

    const rawRole = agRow?.role_desc
    const agRole =
      rawRole === 'PRIMARY' || rawRole === 'SECONDARY' || rawRole === 'RESOLVING'
        ? rawRole
        : undefined

    return {
      machineName: row?.machine_name ?? '',
      instanceName: row?.instance_name ?? null,
      ...(agRole !== undefined && {
        agRole,
        agName: agRow?.ag_name,
        agGroupId: agRow?.group_id
      })
    }
  } finally {
    await pool?.close()
  }
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/main/collectors/sqlCollector.ts
git commit -m "feat(ag): detect AG role/name during test connection"
```

---

## Task 3: Update `AddServerDialog` — AG badge + form fields + credential props

**Files:**
- Modify: `src/renderer/src/components/AddServerDialog.tsx`

- [ ] **Step 1: Extend `AddServerFormData`**

Replace:
```ts
export interface AddServerFormData {
  ip: string
  port: number
  instanceName: string
  machineName?: string
  useWindowsAuth: boolean
  username: string
  password: string
  groupId?: string
  alias?: string
  hostingType: ServerHostingType
}
```
With:
```ts
export interface AddServerFormData {
  ip: string
  port: number
  instanceName: string
  machineName?: string
  useWindowsAuth: boolean
  username: string
  password: string
  groupId?: string
  alias?: string
  hostingType: ServerHostingType
  agRole?: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  agName?: string
  agGroupId?: string
}
```

- [ ] **Step 2: Extend `Props` with credential initial values**

Replace:
```ts
interface Props {
  open: boolean
  initialIp?: string
  initialPort?: number
  initialInstanceName?: string
  onClose: () => void
  onSave: (data: AddServerFormData) => void
}
```
With:
```ts
interface Props {
  open: boolean
  initialIp?: string
  initialPort?: number
  initialInstanceName?: string
  initialUseWindowsAuth?: boolean
  initialUsername?: string
  initialPassword?: string
  onClose: () => void
  onSave: (data: AddServerFormData) => void
}
```

- [ ] **Step 3: Destructure new props in the component**

Replace:
```ts
export function AddServerDialog({
  open,
  initialIp,
  initialPort,
  initialInstanceName,
  onClose,
  onSave
}: Props): React.JSX.Element {
```
With:
```ts
export function AddServerDialog({
  open,
  initialIp,
  initialPort,
  initialInstanceName,
  initialUseWindowsAuth,
  initialUsername,
  initialPassword,
  onClose,
  onSave
}: Props): React.JSX.Element {
```

- [ ] **Step 4: Add `agBadge` state for the detected role**

After the existing `useState` declarations (after line with `setTestLabel`), add:
```ts
const [agBadge, setAgBadge] = useState<{
  role: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  agName: string
  agGroupId: string
} | null>(null)
```

- [ ] **Step 5: Use credential initial values in the reset `useEffect`**

Replace:
```ts
      setForm({
        ...EMPTY_FORM,
        ip: initialIp ?? '',
        port: initialPort ?? 1433,
        instanceName: initialInstanceName ?? '',
        groupId: sortedGroups[0]?.id
      })
```
With:
```ts
      setForm({
        ...EMPTY_FORM,
        ip: initialIp ?? '',
        port: initialPort ?? 1433,
        instanceName: initialInstanceName ?? '',
        useWindowsAuth: initialUseWindowsAuth ?? true,
        username: initialUsername ?? '',
        password: initialPassword ?? '',
        groupId: sortedGroups[0]?.id
      })
      setAgBadge(null)
```

- [ ] **Step 6: Store AG result in `handleTestConnection`**

Replace:
```ts
      const { machineName, instanceName } = result.data
      setForm((prev) => ({
        ...prev,
        machineName,
        instanceName: prev.instanceName?.trim() ? prev.instanceName : (instanceName ?? ''),
        alias: prev.alias?.trim() ? prev.alias : machineName
      }))
      const label = instanceName ? `${machineName}\\${instanceName}` : machineName
      setTestState('success')
      setTestLabel(label)
```
With:
```ts
      const { machineName, instanceName, agRole, agName, agGroupId } = result.data
      setForm((prev) => ({
        ...prev,
        machineName,
        instanceName: prev.instanceName?.trim() ? prev.instanceName : (instanceName ?? ''),
        alias: prev.alias?.trim() ? prev.alias : machineName,
        agRole,
        agName,
        agGroupId
      }))
      if (agRole && agName && agGroupId) {
        setAgBadge({ role: agRole, agName, agGroupId })
      } else {
        setAgBadge(null)
      }
      const label = instanceName ? `${machineName}\\${instanceName}` : machineName
      setTestState('success')
      setTestLabel(label)
```

- [ ] **Step 7: Render AG badge after the success Chip**

After the block:
```tsx
          {testState === 'success' && (
            <Chip
              icon={<CheckCircleIcon />}
              label={`Connected — ${testLabel}`}
              size="small"
              color="success"
              variant="outlined"
            />
          )}
```
Add:
```tsx
          {testState === 'success' && agBadge && (
            <Chip
              label={
                agBadge.role === 'PRIMARY'
                  ? `AG Primary — ${agBadge.agName}`
                  : agBadge.role === 'SECONDARY'
                    ? `AG Secondary — ${agBadge.agName}`
                    : `AG Resolving — ${agBadge.agName}`
              }
              size="small"
              color={agBadge.role === 'PRIMARY' ? 'primary' : agBadge.role === 'SECONDARY' ? 'warning' : 'default'}
              variant="outlined"
            />
          )}
          {testState === 'success' && !agBadge && (
            <Chip label="Standalone" size="small" variant="outlined" />
          )}
```

- [ ] **Step 8: Typecheck**

```
npm run typecheck
```
Expected: no errors.

- [ ] **Step 9: Commit**

```
git add src/renderer/src/components/AddServerDialog.tsx
git commit -m "feat(ag): show AG role badge after test connection in AddServerDialog"
```

---

## Task 4: Pass AG fields on save in `Discovery.tsx`

**Files:**
- Modify: `src/renderer/src/pages/Discovery.tsx:89-118`

- [ ] **Step 1: Add AG fields to the `addServer` call**

Replace:
```ts
    const result = await useServersStore.getState().addServer({
      host: data.ip,
      port: data.port,
      instanceName: data.instanceName || undefined,
      machineName: data.machineName || undefined,
      useWindowsAuth: data.useWindowsAuth,
      username: data.username || undefined,
      password: data.password || undefined,
      hostingType: data.hostingType
    })
```
With:
```ts
    const result = await useServersStore.getState().addServer({
      host: data.ip,
      port: data.port,
      instanceName: data.instanceName || undefined,
      machineName: data.machineName || undefined,
      useWindowsAuth: data.useWindowsAuth,
      username: data.username || undefined,
      password: data.password || undefined,
      hostingType: data.hostingType,
      agRole: data.agRole,
      agName: data.agName,
      agGroupId: data.agGroupId
    })
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/renderer/src/pages/Discovery.tsx
git commit -m "feat(ag): persist agRole/agName/agGroupId from AddServerDialog on save"
```

---

## Task 5: Add `sourceCredentials` to `AgReplicaSuggestion`

**Files:**
- Modify: `src/renderer/src/store/agStore.ts`

- [ ] **Step 1: Extend `AgReplicaSuggestion` interface**

Replace:
```ts
export interface AgReplicaSuggestion {
  agName: string
  missingReplicas: Array<{ replica_server_name: string; role_desc: AgRole }>
}
```
With:
```ts
export interface AgReplicaSuggestion {
  agName: string
  missingReplicas: Array<{ replica_server_name: string; role_desc: AgRole }>
  sourceCredentials: {
    useWindowsAuth: boolean
    username?: string
    password?: string
  }
}
```

- [ ] **Step 2: Include credentials when building suggestions inside `detectAgsForServer`**

Replace:
```ts
        if (missingReplicas.length > 0) {
          newSuggestions.push({ agName: ag.ag_name, missingReplicas })
        }
```
With:
```ts
        if (missingReplicas.length > 0) {
          newSuggestions.push({
            agName: ag.ag_name,
            missingReplicas,
            sourceCredentials: {
              useWindowsAuth: connection.useWindowsAuth,
              username: connection.username,
              password: connection.password
            }
          })
        }
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/store/agStore.ts
git commit -m "feat(ag): carry source server credentials in AgReplicaSuggestion"
```

---

## Task 6: Pass credentials in `AgReplicaSuggestionDialog`

**Files:**
- Modify: `src/renderer/src/components/AgReplicaSuggestionDialog.tsx`

- [ ] **Step 1: Pass credentials as initial props to inner `AddServerDialog`**

Replace:
```tsx
      {addTarget && parsed && (
        <AddServerDialog
          open
          initialIp={parsed.host}
          initialInstanceName={parsed.instance || undefined}
          onClose={() => setAddTarget(null)}
          onSave={handleAddSave}
        />
      )}
```
With:
```tsx
      {addTarget && parsed && (
        <AddServerDialog
          open
          initialIp={parsed.host}
          initialInstanceName={parsed.instance || undefined}
          initialUseWindowsAuth={current.sourceCredentials.useWindowsAuth}
          initialUsername={current.sourceCredentials.username}
          initialPassword={current.sourceCredentials.password}
          onClose={() => setAddTarget(null)}
          onSave={handleAddSave}
        />
      )}
```

- [ ] **Step 2: Also pass AG fields when saving a replica**

Replace:
```ts
  const handleAddSave = async (data: AddServerFormData): Promise<void> => {
    const result = await addServer({
      host: data.ip,
      port: data.port,
      instanceName: data.instanceName || undefined,
      machineName: data.machineName || undefined,
      useWindowsAuth: data.useWindowsAuth,
      username: data.username || undefined,
      password: data.password || undefined,
      hostingType: data.hostingType
    })
```
With:
```ts
  const handleAddSave = async (data: AddServerFormData): Promise<void> => {
    const result = await addServer({
      host: data.ip,
      port: data.port,
      instanceName: data.instanceName || undefined,
      machineName: data.machineName || undefined,
      useWindowsAuth: data.useWindowsAuth,
      username: data.username || undefined,
      password: data.password || undefined,
      hostingType: data.hostingType,
      agRole: data.agRole,
      agName: data.agName,
      agGroupId: data.agGroupId
    })
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/components/AgReplicaSuggestionDialog.tsx
git commit -m "feat(ag): pre-fill credentials and persist AG role when adding replicas"
```

---

## Task 7: Move `AgReplicaSuggestionDialog` to App root

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/pages/Discovery.tsx`

- [ ] **Step 1: Add import + render in `App.tsx`**

In `src/renderer/src/App.tsx`, add import alongside the other component imports (e.g. near `AlertsDrawer`):
```ts
import { AgReplicaSuggestionDialog } from './components/AgReplicaSuggestionDialog'
```

Inside `AppInner` return JSX, add `<AgReplicaSuggestionDialog />` alongside `<AlertsDrawer .../>` and `<GlobalSnackbar />` (they are already at the bottom of the JSX tree). Exact placement: after `<GlobalSnackbar />`:
```tsx
<GlobalSnackbar />
<AgReplicaSuggestionDialog />
```

- [ ] **Step 2: Remove from `Discovery.tsx`**

Remove the import line:
```ts
import { AgReplicaSuggestionDialog } from '../components/AgReplicaSuggestionDialog'
```

Remove the render call from the JSX:
```tsx
      {/* Suggerimento aggiungi repliche AG */}
      <AgReplicaSuggestionDialog />
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/App.tsx src/renderer/src/pages/Discovery.tsx
git commit -m "feat(ag): move AgReplicaSuggestionDialog to app root so it survives navigation"
```

---

## Final: Full build verification

- [ ] **Step 1: Full typecheck**

```
npm run typecheck
```
Expected: no errors in both `typecheck:node` and `typecheck:web`.

- [ ] **Step 2: Dev build smoke test**

```
npm run dev
```
Open the app, add a server that is part of an AG:
1. Click "Test connessione" → verify AG badge appears (PRIMARY/SECONDARY/Standalone)
2. Click Save → server appears in list with role already set (no wait)
3. `AgReplicaSuggestionDialog` appears → verify other replica has credentials pre-filled
4. Navigate to Home while dialog is pending → verify dialog still visible
