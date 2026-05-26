import { describe, expect, it, vi } from 'vitest'

vi.mock('../executeReadOnly', () => ({
  executeReadOnly: vi.fn()
}))

import { buildDiagnosticTools } from '../diagnosticTools'
import type { ServerConnection } from '../../collectors/types'

describe('buildDiagnosticTools', () => {
  it('includes a backup status tool for backup-overdue incidents', () => {
    const tools = buildDiagnosticTools({
      ip: 'localhost',
      port: 1433,
      useWindowsAuth: false
    } as ServerConnection)

    expect(tools.map((tool) => tool.name)).toContain('get_backup_status')
  })
})
