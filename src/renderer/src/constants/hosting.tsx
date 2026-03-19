import StorageIcon from '@mui/icons-material/Storage'
import CloudIcon from '@mui/icons-material/Cloud'

export type ServerHostingType = 'on-premise' | 'cloud'

export const HOSTING_OPTIONS = [
  {
    value: 'on-premise' as const,
    label: 'On-Premise',
    icon: <StorageIcon fontSize="small" />
  },
  {
    value: 'cloud' as const,
    label: 'Cloud',
    icon: <CloudIcon fontSize="small" sx={{ color: '#0078d4' }} />
  }
]

export const HOSTING_BADGE: Record<ServerHostingType, { label: string; color: string }> = {
  'on-premise': { label: 'ON-PREM', color: '#605e5c' },
  cloud: { label: 'CLOUD', color: '#0078d4' }
}
