import { useEffect, useCallback } from 'react'
import type { CollectMetricsRequest } from '../../../../../../preload/index'
import { useAgStore } from '../../../../store/agStore'
import { useShallow } from 'zustand/react/shallow'
import { useVisibilityPoll } from '../../../../hooks/useVisibilityPoll'

export function useAgDataFetch(agName: string, connection: CollectMetricsRequest): void {
  const updateAgDetails = useAgStore(useShallow((s) => s.updateAgDetails))

  useEffect(() => {
    updateAgDetails(connection)
  }, [agName, connection.ip, connection.port]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdate = useCallback(() => {
    updateAgDetails(connection)
  }, [connection, updateAgDetails])

  useVisibilityPoll(handleUpdate, 60_000)
}
