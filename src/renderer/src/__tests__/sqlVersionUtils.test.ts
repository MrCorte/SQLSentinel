// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

// inventoryUtils imports Zustand stores which import ipc → window.sqlSentinel
vi.mock('../api/ipc', () => ({ servers: {}, metrics: {}, alerts: {}, settings: {} }))
vi.mock('../store/serversStore', () => ({ useServersStore: { getState: () => ({ servers: [] }) } }))
vi.mock('../store/groupsStore', () => ({ useGroupsStore: { getState: () => ({ groups: [], serverGroups: {}, serverAliases: {} }) } }))
vi.mock('../store/metricsStore', () => ({ useMetricsStore: { getState: () => ({ metricsMap: {} }) } }))
vi.mock('../store/agStore', () => ({ useAgStore: { getState: () => ({ agGroups: {} }) } }))

import { getSqlServerVersion } from '../utils/inventoryUtils'
import { compatLevelToSqlVersion } from '../utils/sqlVersionUtils'

describe('getSqlServerVersion', () => {
  it('returns "" for undefined', () => {
    expect(getSqlServerVersion(undefined)).toBe('')
  })

  it('returns "" for empty string', () => {
    expect(getSqlServerVersion('')).toBe('')
  })

  it('parses pure ProductVersion string "15.0.4375.4"', () => {
    expect(getSqlServerVersion('15.0.4375.4')).toBe('SQL Server 2019')
  })

  it('parses full @@VERSION string for SQL Server 2019', () => {
    const v =
      'Microsoft SQL Server 2019 (RTM-CU27) - 15.0.4375.4 (X64) Oct 31 2023 01:01:01 Copyright...'
    expect(getSqlServerVersion(v)).toBe('SQL Server 2019')
  })

  it('parses SQL Server 2022 (v16)', () => {
    expect(getSqlServerVersion('16.0.1000.6')).toBe('SQL Server 2022')
  })

  it('parses SQL Server 2017 (v14)', () => {
    expect(getSqlServerVersion('14.0.3257.3')).toBe('SQL Server 2017')
  })

  it('parses SQL Server 2016 (v13)', () => {
    expect(getSqlServerVersion('13.0.5026.0')).toBe('SQL Server 2016')
  })

  it('parses SQL Server 2014 (v12)', () => {
    expect(getSqlServerVersion('12.0.6024.0')).toBe('SQL Server 2014')
  })

  it('parses SQL Server 2012 (v11)', () => {
    expect(getSqlServerVersion('11.0.7493.4')).toBe('SQL Server 2012')
  })

  it('returns generic label for unknown major version', () => {
    expect(getSqlServerVersion('17.0.100.0')).toBe('SQL Server (v17)')
  })

  it('returns "" for string with no version pattern', () => {
    expect(getSqlServerVersion('unknown version')).toBe('')
  })
})

describe('compatLevelToSqlVersion', () => {
  const cases: [number, string][] = [
    [80, 'SQL 2000'],
    [90, 'SQL 2005'],
    [100, 'SQL 2008'],
    [110, 'SQL 2012'],
    [120, 'SQL 2014'],
    [130, 'SQL 2016'],
    [140, 'SQL 2017'],
    [150, 'SQL 2019'],
    [160, 'SQL 2022']
  ]

  cases.forEach(([level, expected]) => {
    it(`level ${level} → "${expected}"`, () => {
      expect(compatLevelToSqlVersion(level)).toBe(expected)
    })
  })

  it('unknown level → "Compat <n>"', () => {
    expect(compatLevelToSqlVersion(999)).toBe('Compat 999')
  })
})
