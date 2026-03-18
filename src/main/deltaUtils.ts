/**
 * Hybrid delta threshold constants.
 * Exported so they can be imported by both metricsWorker and tests.
 */
export const DELTA_THRESHOLD_ABS = 5
export const DELTA_THRESHOLD_PERC = 0.2

/**
 * Returns true when a delta update is worth sending instead of a full refresh.
 *
 * A delta is preferred when the number of changed/removed databases is:
 *   - ≤ DELTA_THRESHOLD_ABS (5)  — always cheap regardless of fleet size, OR
 *   - ≤ DELTA_THRESHOLD_PERC (20%) of the total db count
 *
 * @param changedCount  DBs changed + DBs removed (both drive the IPC payload size)
 * @param totalCount    Total DBs in the *fresh* snapshot + removed DBs
 */
export function shouldSendDelta(changedCount: number, totalCount: number): boolean {
  return (
    changedCount <= DELTA_THRESHOLD_ABS ||
    (totalCount > 0 && changedCount / totalCount <= DELTA_THRESHOLD_PERC)
  )
}
