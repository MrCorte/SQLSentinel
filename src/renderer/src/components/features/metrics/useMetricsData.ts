import { useState, useEffect, useCallback, useMemo } from 'react'
import * as ipc from '../../../api/ipc'
import type {
  ServerMetrics,
  DatabaseInfo,
  DbCustomFields,
  QueryInfo
} from '../../../../../preload/index'
import type { GridRowSelectionModel } from '@mui/x-data-grid'
import { createLogger } from '../../../utils/logger'

export type QueryRow = QueryInfo & { _rowId: string }

const log = createLogger('metrics-panel')

const EMPTY_SELECTION: GridRowSelectionModel = { type: 'include', ids: new Set() }

interface UseMetricsDataParams {
  metrics: ServerMetrics
  serverId: string
}

export interface MetricsData {
  tab: number
  setTab: (v: number) => void

  databases: DatabaseInfo[]
  customFields: Record<string, DbCustomFields>
  editingDb: DatabaseInfo | null
  setEditingDb: (db: DatabaseInfo | null) => void
  handleSaveDbFields: (fields: DbCustomFields) => Promise<void>

  rowSelectionModel: GridRowSelectionModel
  setRowSelectionModel: (model: GridRowSelectionModel) => void
  handleBulkSaveDbFields: (
    fields: { alias: string | undefined; referente: string | undefined }
  ) => Promise<{ failed: string[] }>

  aliasSuggestions: string[]
  ownerSuggestions: string[]

  snackbar: { message: string; severity: 'success' | 'warning' | 'error' } | null
  setSnackbar: (s: { message: string; severity: 'success' | 'warning' | 'error' } | null) => void

  topQueriesRows: QueryRow[]
}

export function useMetricsData({ metrics, serverId }: UseMetricsDataParams): MetricsData {
  const [tab, setTab] = useState(0)
  const [customFields, setCustomFields] = useState<Record<string, DbCustomFields>>({})
  const [editingDb, setEditingDb] = useState<DatabaseInfo | null>(null)
  const [rowSelectionModel, setRowSelectionModel] =
    useState<GridRowSelectionModel>(EMPTY_SELECTION)
  const [snackbar, setSnackbar] = useState<{
    message: string
    severity: 'success' | 'warning' | 'error'
  } | null>(null)

  useEffect(() => {
    ipc
      .getAllDbCustomFields()
      .then((r) => {
        if (r.ok) setCustomFields(r.data)
        else log.error('getAllDbCustomFields error:', r.error)
      })
      .catch((err) => log.error('getAllDbCustomFields threw:', err))
  }, [])

  const databases: DatabaseInfo[] = useMemo(
    () =>
      (metrics.databases ?? []).map((db) => {
        const cf = customFields[`${serverId}/${db.name}`]
        return { ...db, alias: cf?.alias ?? db.alias, referente: cf?.referente ?? db.referente }
      }),
    [metrics.databases, customFields, serverId]
  )

  // Suggestions drawn from all stored custom fields (cross-server, deduplicated)
  const aliasSuggestions = useMemo(
    () =>
      [
        ...new Set(
          Object.values(customFields)
            .map((f) => f.alias)
            .filter((v): v is string => !!v)
        )
      ],
    [customFields]
  )

  const ownerSuggestions = useMemo(
    () =>
      [
        ...new Set(
          Object.values(customFields)
            .map((f) => f.referente)
            .filter((v): v is string => !!v)
        )
      ],
    [customFields]
  )

  const handleSaveDbFields = useCallback(
    async (fields: DbCustomFields) => {
      if (!editingDb) return
      const result = await ipc.setDbCustomFields({ serverId, dbName: editingDb.name, fields })
      if (result.ok) {
        setCustomFields((prev) => ({ ...prev, [`${serverId}/${editingDb.name}`]: fields }))
        setEditingDb(null)
      } else {
        setSnackbar({ message: `Failed to save ${editingDb.name}`, severity: 'error' })
      }
    },
    [editingDb, serverId]
  )

  const handleBulkSaveDbFields = useCallback(
    async (fields: {
      alias: string | undefined
      referente: string | undefined
    }): Promise<{ failed: string[] }> => {
      // GridRowSelectionModel.ids is Set<GridRowId>; cast to string[] since getRowId returns db.name
      const selectedNames = Array.from(rowSelectionModel.ids) as string[]
      const dbFields: DbCustomFields = { alias: fields.alias, referente: fields.referente }

      const results = await Promise.allSettled(
        selectedNames.map((dbName) => ipc.setDbCustomFields({ serverId, dbName, fields: dbFields }))
      )

      const failed = selectedNames.filter((_, i) => {
        const r = results[i]
        return r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
      })
      const succeeded = selectedNames.filter((_, i) => {
        const r = results[i]
        return r.status === 'fulfilled' && r.value.ok
      })

      if (succeeded.length > 0) {
        setCustomFields((prev) => {
          const next = { ...prev }
          for (const dbName of succeeded) next[`${serverId}/${dbName}`] = dbFields
          return next
        })
      }

      setRowSelectionModel(EMPTY_SELECTION)

      if (failed.length === 0) {
        setSnackbar({
          message: `${selectedNames.length} database${selectedNames.length !== 1 ? 's' : ''} updated`,
          severity: 'success'
        })
      } else if (succeeded.length === 0) {
        setSnackbar({ message: `Failed to update: ${failed.join(', ')}`, severity: 'error' })
      } else {
        setSnackbar({
          message: `${succeeded.length} updated, ${failed.length} failed: ${failed.join(', ')}`,
          severity: 'warning'
        })
      }
      return { failed }
    },
    [rowSelectionModel, serverId]
  )

  const topQueriesRows: QueryRow[] = useMemo(() => {
    const seen = new Map<string, number>()
    return (metrics.topQueries ?? []).map((q) => {
      const n = (seen.get(q.queryText) ?? 0) + 1
      seen.set(q.queryText, n)
      return { ...q, _rowId: n === 1 ? q.queryText : `${q.queryText}#${n}` }
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
    rowSelectionModel,
    setRowSelectionModel,
    handleBulkSaveDbFields,
    aliasSuggestions,
    ownerSuggestions,
    snackbar,
    setSnackbar,
    topQueriesRows
  }
}
