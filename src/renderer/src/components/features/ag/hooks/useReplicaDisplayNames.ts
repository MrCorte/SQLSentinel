import { useCallback } from 'react'
import { useServersStore } from '../../../../store/serversStore'
import { useGroupsStore } from '../../../../store/groupsStore'

export function useReplicaDisplayNames(): (replicaServerName: string) => string {
  const servers = useServersStore((s) => s.servers)
  const serverAliases = useGroupsStore((s) => s.serverAliases)

  return useCallback(
    (replicaServerName: string): string => {
      const nameBase = replicaServerName.split('\\')[0].toLowerCase()
      const match = servers.find((s) => {
        const addr = (s.host ?? s.ip ?? '').toLowerCase()
        return addr === nameBase || addr.includes(nameBase) || nameBase.includes(addr)
      })
      if (!match) return replicaServerName
      return serverAliases[match.id] || match.host || replicaServerName
    },
    [servers, serverAliases]
  )
}
