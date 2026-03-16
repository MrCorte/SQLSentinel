import { useState, useCallback } from 'react'
import type { DiscoveredServer, ScanOptions, ScanProgress } from '../../../preload/index'

interface DiscoveryState {
  servers: DiscoveredServer[]
  isScanning: boolean
  progress: ScanProgress | null
  error: string | null
}

export function useDiscovery() {
  const [servers, setServers] = useState<DiscoveredServer[]>([])
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
        setServers(result.data)
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

  return { servers, isScanning, progress, error, scan }
}

// Re-export DiscoveryState for consumers that want the full shape
export type { DiscoveryState }
