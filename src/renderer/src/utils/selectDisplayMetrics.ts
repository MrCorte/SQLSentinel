import type { ServerMetrics } from '../../../preload/index'

export function selectDisplayMetrics(
  localMetrics: ServerMetrics | null,
  cachedMetrics: ServerMetrics | null
): ServerMetrics | null {
  if (cachedMetrics) return cachedMetrics
  if (localMetrics?.isDelta) return null
  return localMetrics
}
