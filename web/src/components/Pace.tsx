import { useEffect, useRef, useState } from 'react'

import { useT } from '../lib/i18n'
import type { RunEvent } from '../lib/api'
import { speed as perSecond } from '../lib/speed'

/**
 * How fast a run is going and how long it has left. The count itself is on
 * the progress bar.
 *
 * Two speeds: the bytes a second the engine reads from rclone's accounting and
 * sends with its moving frames, and the finished files a second counted here
 * from the progress events, which the estimate of the time left rests on. The
 * files are measured over a recent window, so an early slow stretch does not
 * skew the estimate, and afresh for each stage of reading the job, which go at
 * different speeds.
 */

/** How far back the rate looks: long enough to be steady, short enough to react. */
const WINDOW_MS = 15_000

type Sample = { at: number; done: number }

export function Pace({ event, speed = 0 }: { event: RunEvent | undefined; speed?: number }) {
  const { t, lang } = useT()
  const samples = useRef<Sample[]>([])
  const stage = useRef('')
  const [, tick] = useState(0)

  const done = event?.done ?? 0
  const total = event?.total ?? 0

  useEffect(() => {
    if (!event || event.phase !== 'progress') {
      // A finished or restarted run starts its own measurement.
      samples.current = []
      return
    }
    // The side changes with every file once work moves, so it only marks a
    // stage while the job is being read.
    const current = event.stage ? `${event.stage} ${event.side ?? ''}` : ''
    if (current !== stage.current) {
      stage.current = current
      samples.current = []
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

  if (!event || event.phase !== 'progress') return null
  const moving = speed > 0
  if (total <= 0 && !moving) return null

  const first = samples.current[0]
  const last = samples.current[samples.current.length - 1]
  // A zero interval would render the rate as "Infinity".
  const span = first && last ? (last.at - first.at) / 1000 : 0
  const moved = first && last ? last.done - first.done : 0
  const rate = span >= 1 && moved > 0 ? moved / span : null

  const left = total - done
  const seconds = rate && left > 0 ? Math.round(left / rate) : null
  if (rate === null && !moving) return null
  const files = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  return (
    <p className="flex flex-wrap items-center gap-x-3 text-xs tabular-nums text-carbon-textMuted">
      {moving && (
        <span className="font-medium text-carbon-textSub" title={t('progress.speed')}>
          <span className="sr-only">{t('progress.speed')} </span>
          {perSecond(speed, lang)}
        </span>
      )}
      {rate !== null && <span>{t('progress.rate', { rate: files.format(rate) })}</span>}
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
