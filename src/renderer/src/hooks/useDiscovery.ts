import { useState, useCallback, useEffect } from 'react'
import type {
  DiscoveredServer,
  ScanOptions,
  ScanProgress,
  ManualServerRequest
} from '../../../preload/index'
import { notify } from '../store/notifyStore'

// sessionStorage key — survives tab navigation but not app restart, which is
// the right scope for ephemeral scan output.
const SCAN_RESULTS_KEY = 'sqlsentinel:discovery:scanResults'

function loadPersistedScan(): DiscoveryRow[] {
  try {
    const raw = sessionStorage.getItem(SCAN_RESULTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DiscoveryRow[]
    return Array.isArray(parsed)
      ? parsed.map((r) => ({ ...r, discoveredAt: new Date(r.discoveredAt) }))
      : []
  } catch {
    return []
  }
}

function persistScan(rows: DiscoveryRow[]): void {
  try {
    sessionStorage.setItem(SCAN_RESULTS_KEY, JSON.stringify(rows))
  } catch {
    // Quota exceeded or storage unavailable — non-fatal
  }
}

export interface DiscoveryRow extends DiscoveredServer {
  discoveryType: 'auto-tcp' | 'manual'
}

/** Parameters for adding a server manually (credentials included for future use) */
export interface AddServerParams {
  ip: string
  port: number
  instanceName?: string
  useWindowsAuth: boolean
  username?: string
  password?: string
}

export function useDiscovery() {
  const [servers, setServers] = useState<DiscoveryRow[]>(() => loadPersistedScan())
  const [isScanning, setIsScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Persist scan output whenever the result set changes so navigating to
  // Inventory and back doesn't blow it away.
  useEffect(() => {
    persistScan(servers)
  }, [servers])

  const scan = useCallback(async (options: ScanOptions): Promise<void> => {
    setIsScanning(true)
    setError(null)
    setProgress(null)

    const removeProgressListener = window.sqlSentinel.onScanProgress(setProgress)

    try {
      const result = await window.sqlSentinel.scanSubnet(options)
      if (result.ok) {
        const autoRows: DiscoveryRow[] = result.data.map((s) => ({
          ...s,
          discoveryType: 'auto-tcp' as const
        }))
        setServers((prev) => {
          // Manually added servers are preserved unless there is an ip:port conflict
          const manualServers = prev.filter((s) => s.discoveryType === 'manual')
          const autoKeys = new Set(autoRows.map((s) => `${s.ip}:${s.port}`))
          const remainingManual = manualServers.filter((s) => !autoKeys.has(`${s.ip}:${s.port}`))
          return [...autoRows, ...remainingManual]
        })
      } else {
        setError(result.error)
        notify.error(result.error, 'Subnet scan failed')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed unexpectedly'
      setError(msg)
      notify.error(msg, 'Subnet scan failed')
    } finally {
      removeProgressListener()
      setIsScanning(false)
    }
  }, [])

  const cancelScan = useCallback(async (): Promise<void> => {
    // Best-effort: the in-flight scanSubnet will resolve normally with the
    // partial results found before the abort.
    try {
      await window.sqlSentinel.cancelScan()
    } catch {
      // ignored — UI state is reset by scan() finally block when the promise settles
    }
  }, [])

  /**
   * Adds (or updates) a manual server.
   * Runs a TCP probe to verify reachability, then updates the server list.
   */
  const addServer = useCallback(async (params: AddServerParams): Promise<void> => {
    setError(null)
    const req: ManualServerRequest = {
      ip: params.ip,
      port: params.port,
      ...(params.instanceName ? { instanceName: params.instanceName } : {})
    }

    const result = await window.sqlSentinel.addServerManual(req)
    if (result.ok) {
      const newRow: DiscoveryRow = { ...result.data, discoveryType: 'manual' }
      const key = `${params.ip}:${params.port}`
      setServers((prev) => [...prev.filter((s) => `${s.ip}:${s.port}` !== key), newRow])
      notify.success(`Server ${key} added`, 'Server added')
    } else {
      setError(result.error)
      notify.error(result.error, 'Add server failed')
    }
  }, [])

  return { servers, isScanning, progress, error, scan, cancelScan, addServer }
}
