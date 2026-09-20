import { useEffect, useRef, useState } from 'react'

import { useT } from '../lib/i18n'
import type { RunEvent } from '../lib/api'

/**
 * How fast a run is going and how long it has left.
 *
 * The rate is in files per second because progress events carry a count of
 * finished work, not bytes, so one enormous file looks stalled. It is measured
 * over a recent window, so an early slow stretch does not skew the estimate.
 */

/** How far back the rate looks: long enough to be steady, short enough to react. */
const WINDOW_MS = 15_000

type Sample = { at: number; done: number }

export function Pace({ event }: { event: RunEvent | undefined }) {
  const { t } = useT()
  const samples = useRef<Sample[]>([])
  const [, tick] = useState(0)

  const done = event?.done ?? 0
  const total = event?.total ?? 0

  useEffect(() => {
    if (!event || event.phase !== 'progress') {
      // A finished or restarted run starts its own measurement.
      samples.current = []
      return
    }
    const now = Date.now()
    samples.current.push({ at: now, done })
    samples.current = samples.current.filter((s) => now - s.at <= WINDOW_MS)
  }, [event, done])

  // Re-renders every second, so a stalled run does not look nearly done.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (!event || event.phase !== 'progress' || total <= 0) return null

  const first = samples.current[0]
  const last = samples.current[samples.current.length - 1]
  // A zero interval would render the rate as "Infinity".
  const span = first && last ? (last.at - first.at) / 1000 : 0
  const moved = first && last ? last.done - first.done : 0
  const rate = span >= 1 && moved > 0 ? moved / span : null

  const left = total - done
  const seconds = rate && left > 0 ? Math.round(left / rate) : null

  return (
    <p className="flex flex-wrap items-center gap-x-3 text-xs text-carbon-textMuted">
      <span>{t('progress.of', { done, total })}</span>
      {rate !== null && <span>{t('progress.rate', { rate: rate.toFixed(1) })}</span>}
      {seconds !== null && <span>{t('progress.left', { time: humanTime(seconds) })}</span>}
    </p>
  )
}

/**
 * A duration read at a glance. Above a minute it drops the seconds, a
 * precision an estimate from a fifteen-second sample does not have.
 */
export function humanTime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}
