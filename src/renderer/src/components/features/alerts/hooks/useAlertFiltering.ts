import { useState, useMemo, useCallback } from 'react'
import type { Alert } from '../../../../../../preload/index'

type SeverityFilter = 'all' | 'CRITICAL' | 'WARNING'
type CategoryFilter = 'all' | Alert['category']
type AlertWithDup = Alert & { _dupCount?: number }

interface UseAlertFilteringReturn {
  severityFilter: SeverityFilter
  categoryFilter: CategoryFilter
  dedup: boolean
  setSeverityFilter: (f: SeverityFilter) => void
  setCategoryFilter: (f: CategoryFilter) => void
  setDedupPersist: (next: boolean) => void
  openAlerts: Alert[]
  acked: Alert[]
  availableCategories: Alert['category'][]
  filteredOpen: Alert[]
  criticalFirst: AlertWithDup[]
}

export function useAlertFiltering(alerts: Alert[]): UseAlertFilteringReturn {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [dedup, setDedup] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem('sqlsentinel:alerts:dedup')
      return stored === null ? true : stored === '1'
    } catch {
      return true
    }
  })

  const setDedupPersist = (next: boolean): void => {
    setDedup(next)
    try {
      sessionStorage.setItem('sqlsentinel:alerts:dedup', next ? '1' : '0')
    } catch {
      // non-fatal
    }
  }

  const openAlerts = useMemo(() => alerts.filter((a) => a.acknowledgedAt === null), [alerts])
  const acked = useMemo(() => alerts.filter((a) => a.acknowledgedAt !== null), [alerts])

  const availableCategories = useMemo(() => {
    const set = new Set<Alert['category']>()
    for (const a of openAlerts) set.add(a.category)
    return Array.from(set)
  }, [openAlerts])

  const matchesFilters = useCallback(
    (a: Alert): boolean => {
      if (severityFilter !== 'all' && a.severity !== severityFilter) return false
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
      return true
    },
    [severityFilter, categoryFilter]
  )

  const filteredOpen = useMemo(() => openAlerts.filter(matchesFilters), [openAlerts, matchesFilters])

  const dedupedOpen = useMemo(() => {
    if (!dedup) return filteredOpen
    const groups = new Map<string, Array<Alert>>()
    for (const a of filteredOpen) {
      const key = `${a.serverId}::${a.category}`
      const list = groups.get(key) ?? []
      list.push(a)
      groups.set(key, list)
    }
    const out: AlertWithDup[] = []
    for (const list of groups.values()) {
      list.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
      const head = list[0]
      out.push(list.length > 1 ? { ...head, _dupCount: list.length } : head)
    }
    return out
  }, [filteredOpen, dedup])

  const criticalFirst = useMemo(
    () =>
      [...dedupedOpen].sort((a, b) => {
        if (a.severity === 'CRITICAL' && b.severity !== 'CRITICAL') return -1
        if (b.severity === 'CRITICAL' && a.severity !== 'CRITICAL') return 1
        return 0
      }),
    [dedupedOpen]
  )

  return {
    severityFilter,
    categoryFilter,
    dedup,
    setSeverityFilter,
    setCategoryFilter,
    setDedupPersist,
    openAlerts,
    acked,
    availableCategories,
    filteredOpen,
    criticalFirst
  }
}
