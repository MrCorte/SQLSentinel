---
name: ipc-channel
description: Scaffold a complete typed IPC channel (enum entry, handler, preload bridge, renderer type) following SQLSentinel conventions
disable-model-invocation: true
---

# ipc-channel

Add a new typed IPC channel end-to-end. Usage: `/ipc-channel <channel-name> <RequestType> <ResponseType>`

## Steps

### 1. Add channel to enum — `src/main/ipc/types.ts`

```typescript
// In IpcChannel enum:
<CHANNEL_NAME_UPPER> = '<channel-name>',
```

Also define request/response types if not already existing:

```typescript
export interface <Request>Type {
  // fields
}
```

### 2. Create handler file — `src/main/ipc/handlers/<channelName>.ipc.ts`

```typescript
import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { IpcChannel, type IpcResult } from '../types'
import type { <RequestType> } from '../types'

export function register<ChannelName>Handlers(): void {
  handle(
    IpcChannel.<CHANNEL_NAME_UPPER>,
    async (_e: IpcMainInvokeEvent, req: <RequestType>): Promise<IpcResult<<ResponseType>>> => {
      try {
        // implementation
        return { ok: true, data: result }
      } catch (err) {
        log.error('[IPC] <CHANNEL_NAME_UPPER>:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
```

**Rules:**
- Always return `IpcResult<T>` — never throw from handler
- Log errors with `safeError(err)` — strips credentials
- Use `handle()` wrapper from `handleWrapper.ts`, never raw `ipcMain.handle()`

### 3. Register — `src/main/ipc/index.ts`

```typescript
import { register<ChannelName>Handlers } from './handlers/<channelName>.ipc'
// inside registerAllHandlers():
register<ChannelName>Handlers()
```

### 4. Expose in preload — `src/preload/index.ts`

```typescript
// Inside contextBridge.exposeInMainWorld('sqlSentinel', { ... }):
<channelName>: (req: <RequestType>) =>
  ipcRenderer.invoke(IpcChannel.<CHANNEL_NAME_UPPER>, req),
```

### 5. Add to type declaration — `src/preload/index.d.ts`

```typescript
// Inside SqlSentinelAPI interface:
<channelName>: (req: <RequestType>) => Promise<IpcResult<<ResponseType>>>
```

### 6. Use in renderer — `src/renderer/src/`

```typescript
const result = await window.sqlSentinel.<channelName>(req)
if (!result.ok) { /* handle error */ }
const data = result.data
```

### 7. Verify

```bash
npm run typecheck
```

Both `tsconfig.node.json` and `tsconfig.web.json` must pass.
