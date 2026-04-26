---
name: sql-collector
description: Scaffold a new T-SQL metric collector following SQLSentinel conventions (snake_case aliases, parameterized queries, mssql pool, typed return, IPC wiring)
disable-model-invocation: true
---

# sql-collector

Create a new SQL Server metric collector. Usage: `/sql-collector <MetricName>`

## Steps

1. **Create collector file** `src/main/collectors/<camelCaseMetricName>Collector.ts`

Follow this exact pattern (copy from `agCollector.ts`):

```typescript
import * as mssql from 'mssql'
import { createLogger } from '../utils/logger'
const log = createLogger('<metric-name>-collector')
import type { CollectMetricsRequest } from '../ipc/types'
import type { <MetricType> } from './types'
import { sanitizeSqlError } from './sqlCollector'

function buildConfig(conn: CollectMetricsRequest): mssql.config {
  // — copy buildConfig from agCollector.ts verbatim —
}

export async function get<MetricName>(conn: CollectMetricsRequest): Promise<<MetricType>[]> {
  let pool: mssql.ConnectionPool | null = null
  try {
    pool = await mssql.connect(buildConfig(conn))
    const result = await pool.request().query<{MetricType}>(`
      SELECT
        <columns>  AS <snake_case_alias>
      FROM <view_or_table>
      WHERE <condition>
    `)
    return result.recordset
  } catch (err) {
    log.error('get<MetricName>:', sanitizeSqlError(err))
    return []
  } finally {
    await pool?.close()
  }
}
```

**Rules:**
- T-SQL column aliases: `snake_case`
- No credentials in error logs — use `sanitizeSqlError`
- Always close pool in `finally`
- `requestTimeout: 15_000`, `connectTimeout: 10_000`
- `encrypt: false`, `trustServerCertificate: true`
- Support both Windows auth (ntlm) and SQL auth (default)

2. **Add types** to `src/main/collectors/types.ts`:

```typescript
export interface <MetricType> {
  <field>: <type>
  // snake_case field names matching T-SQL aliases
}
```

3. **Add IPC channel** to `src/main/ipc/types.ts`:

```typescript
// In IpcChannel enum:
GET_<METRIC_NAME_UPPER> = 'get-<metric-name>',
```

4. **Create IPC handler** `src/main/ipc/handlers/<metricName>.ipc.ts`:

```typescript
import type { IpcMainInvokeEvent } from 'electron'
import { handle, safeError, log } from '../handleWrapper'
import { get<MetricName> } from '../../collectors/<metricName>Collector'
import { IpcChannel, type IpcResult } from '../types'
import { resolveConnection } from './servers.ipc'
import type { <MetricType> } from '../../collectors/types'

export function register<MetricName>Handlers(): void {
  handle(
    IpcChannel.GET_<METRIC_NAME_UPPER>,
    async (_e: IpcMainInvokeEvent, req: { serverId: string }): Promise<IpcResult<<MetricType>[]>> => {
      try {
        const conn = resolveConnection(req.serverId)
        const data = await get<MetricName>(conn)
        return { ok: true, data }
      } catch (err) {
        log.error('[IPC] GET_<METRIC_NAME_UPPER>:', safeError(err))
        return { ok: false, error: safeError(err) }
      }
    }
  )
}
```

5. **Register handler** in `src/main/ipc/index.ts` — import and call `register<MetricName>Handlers()`

6. **Expose in preload** `src/preload/index.ts` — add channel to contextBridge under `window.sqlSentinel`

7. **Add type declaration** to `src/preload/index.d.ts`:

```typescript
get<MetricName>: (req: { serverId: string }) => Promise<IpcResult<<MetricType>[]>>
```

8. **Run** `npm run typecheck` to verify.
