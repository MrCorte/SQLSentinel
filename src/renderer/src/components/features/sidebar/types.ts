import type { StoredServer } from '../../../../../preload/index'
import type { AgGroupState } from '../../../store/agStore'
import type { ServerGroup } from '../../../types/index'

// ---------------------------------------------------------------------------
// SidebarItem — discriminated union for the flat virtualised list
// ---------------------------------------------------------------------------

export type SidebarItem =
  | { kind: 'group'; group: ServerGroup; onlineCount: number }
  | { kind: 'server'; server: StoredServer; inAgGroup: boolean; inMachineGroup: boolean }
  | { kind: 'ag'; agName: string; agInfo: AgGroupState; isExpanded: boolean }
  | { kind: 'machine'; machineName: string; instanceCount: number; isExpanded: boolean }
  | { kind: 'ungrouped-header' }
  | { kind: 'search-server'; server: StoredServer }
  | { kind: 'no-results' }

/**
 * Returns the estimated row height (px) for a given sidebar item kind.
 *   group / ungrouped-header / machine → 40 px (section headers)
 *   everything else                    → 36 px (server rows)
 */
export function getSidebarItemSize(item: SidebarItem | undefined): number {
  if (!item) return 36
  return item.kind === 'group' || item.kind === 'ungrouped-header' || item.kind === 'machine'
    ? 40
    : 36
}
