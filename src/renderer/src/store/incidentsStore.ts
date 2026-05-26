import { create } from 'zustand'
import type {
  Incident,
  IncidentAiStats,
  IncidentDetail,
  IncidentStatus
} from '../../../preload/index'

interface IncidentsStore {
  incidents: Incident[]
  openCount: number
  aiStats: IncidentAiStats | null
  selectedId: string | null
  detail: IncidentDetail | null
  loadingDetail: boolean

  setIncidents: (incidents: Incident[]) => void
  upsertIncident: (incident: Incident) => void
  setOpenCount: (n: number) => void
  setAiStats: (stats: IncidentAiStats | null) => void
  setSelectedId: (id: string | null) => void
  setDetail: (detail: IncidentDetail | null) => void
  setLoadingDetail: (loading: boolean) => void
}

export const useIncidentsStore = create<IncidentsStore>((set) => ({
  incidents: [],
  openCount: 0,
  aiStats: null,
  selectedId: null,
  detail: null,
  loadingDetail: false,

  setIncidents: (incidents) => set({ incidents }),

  upsertIncident: (incident) =>
    set((state) => {
      const idx = state.incidents.findIndex((i) => i.id === incident.id)
      if (idx === -1) {
        return {
          incidents: [incident, ...state.incidents],
          openCount: isActiveStatus(incident.status) ? state.openCount + 1 : state.openCount
        }
      }
      const prev = state.incidents[idx]
      const wasActive = isActiveStatus(prev.status)
      const isActive = isActiveStatus(incident.status)
      const delta = isActive && !wasActive ? 1 : !isActive && wasActive ? -1 : 0
      const updated = [...state.incidents]
      updated[idx] = incident
      return { incidents: updated, openCount: Math.max(0, state.openCount + delta) }
    }),

  setOpenCount: (openCount) => set({ openCount }),
  setAiStats: (aiStats) => set({ aiStats }),
  setSelectedId: (selectedId) => set({ selectedId, detail: null }),
  setDetail: (detail) => set({ detail }),
  setLoadingDetail: (loadingDetail) => set({ loadingDetail })
}))

function isActiveStatus(status: IncidentStatus): boolean {
  return status === 'open' || status === 'investigating' || status === 'awaiting_approval'
}

export function loadIncidents(filter?: { status?: IncidentStatus }): void {
  window.sqlSentinel.incidents.list(filter).then((res) => {
    if (res.ok) useIncidentsStore.getState().setIncidents(res.data)
  })
}

export function loadOpenCount(): void {
  window.sqlSentinel.incidents.countOpen().then((res) => {
    if (res.ok) useIncidentsStore.getState().setOpenCount(res.data)
  })
}

export function loadAiStats(): void {
  window.sqlSentinel.incidents.aiStats().then((res) => {
    if (res.ok) useIncidentsStore.getState().setAiStats(res.data)
  })
}

export function loadDetail(id: string): void {
  const { setDetail, setLoadingDetail } = useIncidentsStore.getState()
  setLoadingDetail(true)
  window.sqlSentinel.incidents.get(id).then((res) => {
    if (res.ok) setDetail(res.data)
    setLoadingDetail(false)
  })
}
