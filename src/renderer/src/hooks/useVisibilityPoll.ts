import { useEffect, useRef } from 'react'

export function useVisibilityPoll(callback: () => void, intervalMs: number): void {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null

    function start() {
      if (id !== null) return
      id = setInterval(() => savedCallback.current(), intervalMs)
    }

    function stop() {
      if (id === null) return
      clearInterval(id)
      id = null
    }

    function onVisibility() {
      if (document.hidden) stop()
      else start()
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) start()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [intervalMs])
}
