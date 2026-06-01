import { useRef, useMemo } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import type { Alert } from '../../../../../../preload/index'

type AlertWithDup = Alert & { _dupCount?: number }

type VirtualItem =
  | { kind: 'header'; label: string }
  | { kind: 'divider' }
  | { kind: 'alert'; alert: AlertWithDup }

const ROW_HEIGHT_HEADER = 32
const ROW_HEIGHT_DIVIDER = 17
const ROW_HEIGHT_ALERT = 104

interface UseAlertVirtualizationReturn {
  scrollRef: React.RefObject<HTMLDivElement | null>
  virtualItems: VirtualItem[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
}

export function useAlertVirtualization(
  criticalFirst: AlertWithDup[],
  acked: Alert[]
): UseAlertVirtualizationReturn {
  const virtualItems = useMemo<VirtualItem[]>(() => {
    const items: VirtualItem[] = []
    if (criticalFirst.length > 0) {
      items.push({ kind: 'header', label: 'Active' })
      for (const a of criticalFirst) items.push({ kind: 'alert', alert: a })
    }
    if (acked.length > 0) {
      if (criticalFirst.length > 0) items.push({ kind: 'divider' })
      items.push({ kind: 'header', label: 'Acknowledged' })
      for (const a of acked) items.push({ kind: 'alert', alert: a })
    }
    return items
  }, [criticalFirst, acked])

  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const item = virtualItems[i]
      if (item.kind === 'header') return ROW_HEIGHT_HEADER
      if (item.kind === 'divider') return ROW_HEIGHT_DIVIDER
      return ROW_HEIGHT_ALERT
    },
    overscan: 5
  })

  return { scrollRef, virtualItems, virtualizer }
}
