import { useEffect, useRef, useState } from 'react'

/**
 * A number that goes up every second while `active` holds, and once more when
 * it stops, for a list that asks the engine again while a run goes and settles
 * on the engine's answer after it. A polled list rather than one built from
 * the progress events, which the desktop window thins out and a slow reader
 * drops. A hidden page skips the ticks.
 */
export function useLiveTick(active: boolean, every = 1000): number {
  const [tick, setTick] = useState(0)
  const was = useRef(active)

  useEffect(() => {
    if (was.current && !active) setTick((n) => n + 1)
    was.current = active
    if (!active) return
    const id = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1)
    }, every)
    return () => clearInterval(id)
  }, [active, every])

  return tick
}
