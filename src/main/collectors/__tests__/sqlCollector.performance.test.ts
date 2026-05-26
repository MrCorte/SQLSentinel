import { describe, it, expect } from 'vitest'
import { buildBackupStatusSql } from '../sqlCollector'

describe('buildBackupStatusSql', () => {
  it('limits msdb backupset scan to a bounded lookback window', () => {
    const sql = buildBackupStatusSql()

    expect(sql).toContain('backup_finish_date >= DATEADD(DAY')
    expect(sql).toContain('LEFT JOIN msdb.dbo.backupset')
  })
})
