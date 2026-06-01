import { useState, useCallback } from 'react'
import type { AvailabilityReplica } from '../../../../../../preload/index'
import { useServersStore } from '../../../../store/serversStore'
import { useAppStore } from '../../../../store/appStore'

interface UseServerNavigationReturn {
  snackbarMsg: string | null
  closeSnackbar: () => void
  handleNavigateToServer: (replica: AvailabilityReplica) => void
}

export function useServerNavigation(): UseServerNavigationReturn {
  const servers = useServersStore((s) => s.servers)
  const setPendingServerId = useAppStore((s) => s.setPendingServerId)
  const [snackbarMsg, setSnackbarMsg] = useState<string | null>(null)

  const handleNavigateToServer = useCallback(
    (replica: AvailabilityReplica): void => {
      const nameBase = replica.replica_server_name.split('\\')[0].toLowerCase()
      const match = servers.find((s) => {
        const addr = (s.host ?? s.ip ?? '').toLowerCase()
        return addr === nameBase || addr.includes(nameBase) || nameBase.includes(addr)
      })
      if (match) {
        setPendingServerId(match.id)
      } else {
        setSnackbarMsg(
          `Server "${replica.replica_server_name}" is not in the monitored servers list. Add it first from Discovery.`
        )
      }
    },
    [servers, setPendingServerId]
  )

  return { snackbarMsg, closeSnackbar: () => setSnackbarMsg(null), handleNavigateToServer }
}
