import { Chip } from '@mui/material'

interface Props {
  reachable: boolean | null
  responseTimeMs?: number
}

export function ServerStatusChip({ reachable, responseTimeMs }: Props): React.JSX.Element {
  if (reachable === null || reachable === undefined) {
    return <Chip label="Sconosciuto" size="small" color="default" />
  }

  if (reachable) {
    const label = responseTimeMs !== undefined ? `Raggiungibile ${responseTimeMs}ms` : 'Raggiungibile'
    return <Chip label={label} size="small" color="success" />
  }

  return <Chip label="Non raggiungibile" size="small" color="error" />
}
