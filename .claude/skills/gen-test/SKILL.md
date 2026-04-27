---
name: gen-test
description: Scaffold a Vitest test file for a SQLSentinel module (IPC handler, collector, Zustand store, or React component). Usage: /gen-test <source-file-path>
disable-model-invocation: true
---

# gen-test

Generate a Vitest test file for the given source module. Usage: `/gen-test <source-file-path>`

## Rules

- Determine module type from the file path:
  - `src/main/collectors/` → **Collector test** (mock `mssql`, assert on `recordset`)
  - `src/main/ipc/handlers/` → **IPC handler test** (mock collector, assert `IpcResult`)
  - `src/main/store/` → **Store test** (use real better-sqlite3 in-memory DB)
  - `src/renderer/src/store/` → **Zustand store test** (reset store between tests)
  - `src/renderer/src/components/` or `src/renderer/src/hooks/` → **RTL component/hook test**
  - `src/main/` (other) → **Unit test** (pure function, no mocks unless needed)

- Output path: same directory as source in a `__tests__/` subfolder, e.g.
  `src/main/collectors/__tests__/fooCollector.test.ts`
  Exception: main-level `__tests__/` already exists — place there.

- Always add `@vitest/environment` comment at top if jsdom is needed:
  `// @vitest-environment jsdom`

## Templates

### Collector test

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as mssql from 'mssql'
import { get<MetricName> } from '../<metricName>Collector'

vi.mock('mssql')

const mockRequest = { query: vi.fn() }
const mockPool = { request: () => mockRequest, close: vi.fn() }

beforeEach(() => {
  vi.mocked(mssql.connect).mockResolvedValue(mockPool as unknown as mssql.ConnectionPool)
  mockRequest.query.mockResolvedValue({ recordset: [] })
})

describe('get<MetricName>', () => {
  it('returns empty array on empty recordset', async () => {
    const result = await get<MetricName>({ host: 'localhost', port: 1433, /* ... */ } as any)
    expect(result).toEqual([])
  })

  it('returns mapped rows from recordset', async () => {
    mockRequest.query.mockResolvedValue({ recordset: [{ /* snake_case fields */ }] })
    const result = await get<MetricName>({ host: 'localhost', port: 1433 } as any)
    expect(result).toHaveLength(1)
  })

  it('returns empty array on connection error', async () => {
    vi.mocked(mssql.connect).mockRejectedValue(new Error('connect failed'))
    const result = await get<MetricName>({ host: 'bad', port: 1433 } as any)
    expect(result).toEqual([])
  })
})
```

### IPC handler test

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { register<ChannelName>Handlers } from '../<channelName>.ipc'
import * as collector from '../../../collectors/<metricName>Collector'

vi.mock('../../../collectors/<metricName>Collector')
vi.mock('../handleWrapper', () => ({
  handle: vi.fn((_, fn) => fn),
  safeError: (e: unknown) => String(e),
  log: { error: vi.fn() }
}))

describe('<channelName> IPC handler', () => {
  it('returns ok:true with data on success', async () => {
    vi.mocked(collector.get<MetricName>).mockResolvedValue([{ /* fields */ }])
    // invoke handler directly and assert IpcResult shape
    const result = await handler({ serverId: 'test-id' })
    expect(result).toEqual({ ok: true, data: expect.any(Array) })
  })

  it('returns ok:false on error', async () => {
    vi.mocked(collector.get<MetricName>).mockRejectedValue(new Error('fail'))
    const result = await handler({ serverId: 'test-id' })
    expect(result.ok).toBe(false)
  })
})
```

### Zustand store test (renderer)

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { use<StoreName> } from '../<storeName>'

beforeEach(() => {
  use<StoreName>.setState(use<StoreName>.getInitialState())
})

describe('<StoreName>', () => {
  it('initial state is correct', () => {
    const state = use<StoreName>.getState()
    expect(state.<field>).toBe(<defaultValue>)
  })

  it('<action> updates state correctly', () => {
    use<StoreName>.getState().<action>(<args>)
    expect(use<StoreName>.getState().<field>).toBe(<expectedValue>)
  })
})
```

### RTL component test

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { <ComponentName> } from '../<ComponentName>'

vi.mock('../../../../api/ipc', () => ({ ipc: { <method>: vi.fn() } }))

describe('<ComponentName>', () => {
  it('renders without crashing', () => {
    render(<ComponentName <requiredProps> />)
    expect(screen.getByRole('<role>')).toBeInTheDocument()
  })
})
```

## Steps

1. Read the source file at the provided path.
2. Identify module type using the rules above.
3. Extract: exported function/component names, types used, dependencies imported.
4. Choose the matching template and fill in all placeholders.
5. Add at minimum 3 test cases: happy path, empty/no-data path, error path.
6. Write the file to the correct `__tests__/` location.
7. Run `npm run typecheck` to verify the generated file compiles.
