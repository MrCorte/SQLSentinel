import { useEffect, type ReactNode } from 'react'
import { useAlertsStore } from '../../store/alertsStore'
import { tokens } from '../../styles/tokens'

interface Props {
  children: ReactNode
}

export function AccentProvider({ children }: Props): React.JSX.Element {
  const hasCritical = useAlertsStore((s) =>
    s.alerts.some((a) => a.severity === 'CRITICAL' && a.acknowledgedAt === null)
  )

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--color-accent',
      hasCritical ? tokens.color.accentAlert : tokens.color.accent
    )
  }, [hasCritical])

  return <>{children}</>
}
