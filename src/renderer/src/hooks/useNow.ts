import { useState, useEffect } from 'react'

/**
 * Returns the current time as epoch millis, refreshing every `intervalMs`
 * milliseconds. Returns a number (not a Date) so that consumers who pass it
 * down as a prop don't invalidate React.memo on every tick — React.memo can
 * shallow-compare a primitive, whereas a fresh `Date` object always fails the
 * comparison and cascades re-renders through any memoized list items.
 *
 * Default interval is 60s because the typical consumer (age labels) has a
 * minute-level granularity — going faster would only waste re-renders.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
