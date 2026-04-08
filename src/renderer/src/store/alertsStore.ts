import { create } from 'zustand'
import type { Alert } from '../../../preload/index'

const MAX_ALERTS = 500
const MAX_ALERT_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 giorni

interface AlertsStore {
  alerts: Alert[]
  setAlerts: (alerts: Alert[]) => void
  addAlert: (alert: Alert) => void
  acknowledgeAlert: (alertId: string) => void
}

export const useAlertsStore = create<AlertsStore>((set) => ({
  alerts: [],
  setAlerts: (alerts) => {
    const cutoff = Date.now() - MAX_ALERT_AGE_MS
    let next = alerts.filter((a) => new Date(a.detectedAt).getTime() >= cutoff)
    if (next.length > MAX_ALERTS) next = next.slice(next.length - MAX_ALERTS)
    set({ alerts: next })
  },
  addAlert: (alert) =>
    set((state) => {
      const cutoff = Date.now() - MAX_ALERT_AGE_MS
      let next = [...state.alerts, alert].filter((a) => new Date(a.detectedAt).getTime() >= cutoff)
      if (next.length > MAX_ALERTS) next = next.slice(next.length - MAX_ALERTS)
      return { alerts: next }
    }),
  acknowledgeAlert: (alertId) =>
    set((state) => ({
      alerts: state.alerts.map((a) =>
        a.id === alertId ? { ...a, acknowledgedAt: new Date() } : a
      )
    }))
}))
