import { useState, useCallback } from 'react'
import type {
  DiscoveredServer,
  ScanOptions,
  ScanProgress,
  ManualServerRequest
} from '../../../preload/index'

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
  const [servers, setServers] = useState<DiscoveryRow[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      }
    } catch {
      setError('Scan failed unexpectedly')
    } finally {
      removeProgressListener()
      setIsScanning(false)
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
    } else {
      setError(result.error)
    }
  }, [])

  return { servers, isScanning, progress, error, scan, addServer }
}
