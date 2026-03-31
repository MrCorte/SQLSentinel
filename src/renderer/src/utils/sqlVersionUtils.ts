const COMPAT_MAP: Record<number, string> = {
  80: 'SQL 2000',
  90: 'SQL 2005',
  100: 'SQL 2008',
  110: 'SQL 2012',
  120: 'SQL 2014',
  130: 'SQL 2016',
  140: 'SQL 2017',
  150: 'SQL 2019',
  160: 'SQL 2022'
}

export function compatLevelToSqlVersion(level: number): string {
  return COMPAT_MAP[level] ?? `Compat ${level}`
}
