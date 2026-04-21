import { useEffect } from 'react'

export function useIpcEvent(
  subscribe: (handler: (...args: unknown[]) => void) => () => void,
  handler: (...args: unknown[]) => void
): void {
  useEffect(() => {
    return subscribe(handler)
  }, [subscribe, handler])
}
