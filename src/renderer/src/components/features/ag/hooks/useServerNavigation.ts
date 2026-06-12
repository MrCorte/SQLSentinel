import { useState, useCallback } from 'react'
import type { AvailabilityReplica } from '../../../../../../preload/index'
import { useServersStore } from '../../../../store/serversStore'
import { useAppStore } from '../../../../store/appStore'
import { replicaMatchesServer } from '../../../../store/agStore'

interface UseServerNavigationReturn {
  snackbarMsg: string | null
  closeSnackbar: () => void
  handleNavigateToServer: (replica: AvailabilityReplica) => void
}

export function useServerNavigation(): UseServerNavigationReturn {
  const servers = useServersStore((s) => s.servers)
  const setSelectedServerId = useAppStore((s) => s.setSelectedServerId)
  const setSelectedAgName = useAppStore((s) => s.setSelectedAgName)
  const [snackbarMsg, setSnackbarMsg] = useState<string | null>(null)

  const handleNavigateToServer = useCallback(
    (replica: AvailabilityReplica): void => {
      // Stesso matcher del clustering AG (host/ip + machineName): un server
      // registrato per IP si raggiunge tramite il machineName rilevato.
      const nameBase = replica.replica_server_name.split('\\')[0].toLowerCase()
      const match = servers.find((s) => replicaMatchesServer(nameBase, s))
      if (match) {
        // Selezione diretta nello stato condiviso: il Dashboard passa dalla
        // vista AG a quella del server selezionato.
        setSelectedAgName(null)
        setSelectedServerId(match.id)
      } else {
        setSnackbarMsg(
          `Server "${replica.replica_server_name}" is not in the monitored servers list. Add it first from Discovery.`
        )
      }
    },
    [servers, setSelectedServerId, setSelectedAgName]
  )

  return { snackbarMsg, closeSnackbar: () => setSnackbarMsg(null), handleNavigateToServer }
}
