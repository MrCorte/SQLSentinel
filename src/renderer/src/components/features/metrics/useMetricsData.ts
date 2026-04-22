import { useState, useEffect, useCallback, useMemo } from 'react'
import * as ipc from '../../../api/ipc'
import type {
  ServerMetrics,
  DatabaseInfo,
  DbCustomFields,
  QueryInfo
} from '../../../../../preload/index'

export type QueryRow = QueryInfo & { _rowId: string }
import { createLogger } from '../../../utils/logger'

const log = createLogger('metrics-panel')

interface UseMetricsDataParams {
  metrics: ServerMetrics
  serverId: string
}

export interface MetricsData {
  // Tab state
  tab: number
  setTab: (v: number) => void

  // Database tab
  databases: DatabaseInfo[]
  customFields: Record<string, DbCustomFields>
  editingDb: DatabaseInfo | null
  setEditingDb: (db: DatabaseInfo | null) => void
  handleSaveDbFields: (fields: DbCustomFields) => Promise<void>

  // Top queries tab — deduplicated row ids
  topQueriesRows: QueryRow[]
}

export function useMetricsData({ metrics, serverId }: UseMetricsDataParams): MetricsData {
  const [tab, setTab] = useState(0)
  const [customFields, setCustomFields] = useState<Record<string, DbCustomFields>>({})
  const [editingDb, setEditingDb] = useState<DatabaseInfo | null>(null)

  // Load all DB custom fields once on mount
  useEffect(() => {
    ipc
      .getAllDbCustomFields()
      .then((r) => {
        if (r.ok) setCustomFields(r.data)
        else log.error('getAllDbCustomFields error:', r.error)
      })
      .catch((err) => log.error('getAllDbCustomFields threw:', err))
  }, [])

  // Merge persisted custom fields into the database list
  const databases: DatabaseInfo[] = useMemo(
    () =>
      (metrics.databases ?? []).map((db) => {
        const cf = customFields[`${serverId}/${db.name}`]
        return {
          ...db,
          alias: cf?.alias ?? db.alias,
          referente: cf?.referente ?? db.referente
        }
      }),
    [metrics.databases, customFields, serverId]
  )

  const handleSaveDbFields = useCallback(
    async (fields: DbCustomFields) => {
      if (!editingDb) return
      const result = await ipc.setDbCustomFields({ serverId, dbName: editingDb.name, fields })
      if (result.ok) {
        setCustomFields((prev) => ({
          ...prev,
          [`${serverId}/${editingDb.name}`]: fields
        }))
        setEditingDb(null)
      }
    },
    [editingDb, serverId]
  )

  // Stable deduplication of query rows — id derived from query text
  const topQueriesRows: QueryRow[] = useMemo(() => {
    const seen = new Map<string, number>()
    return (metrics.topQueries ?? []).map((q) => {
      const n = (seen.get(q.queryText) ?? 0) + 1
      seen.set(q.queryText, n)
      const _rowId = n === 1 ? q.queryText : `${q.queryText}#${n}`
      return { ...q, _rowId }
    })
  }, [metrics.topQueries])

  return {
    tab,
    setTab,
    databases,
    customFields,
    editingDb,
    setEditingDb,
    handleSaveDbFields,
    topQueriesRows
  }
}
