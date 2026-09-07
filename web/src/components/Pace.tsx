import { useEffect, useRef, useState } from 'react'

import { useT } from '../lib/i18n'
import type { RunEvent } from '../lib/api'

/**
 * How fast a run is going and how long it has left.
 *
 * The bar already says how far along it is, and a bar alone answers the wrong
 * question: "half done" is useless without "and the other half is four minutes".
 *
 * FILES per second, not bytes, and that is a limit worth stating rather than
 * hiding. The progress events carry a count of finished pieces of work and not
 * a byte total, so a run moving one enormous file looks stalled here while it is
 * working perfectly. Saying "files" in the label is what stops that reading as a
 * fault: a number labelled honestly is better than a byte figure invented from
 * data that is not there.
 *
 * The rate is measured over a WINDOW rather than since the start. A run that
 * spent its first minute on one huge file and is now flying through small ones
 * would otherwise report the average of the two for ever, and the estimate it
 * produces would be wrong in the direction that matters: too pessimistic
 * exactly when somebody is deciding whether to wait.
 */

/** How far back the rate looks. Long enough to be steady, short enough to react. */
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
      // A finished or restarted run starts its own measurement. Carrying the
      // last run's samples forward would report a rate for work that is over.
      samples.current = []
      return
    }
    const now = Date.now()
    samples.current.push({ at: now, done })
    samples.current = samples.current.filter((s) => now - s.at <= WINDOW_MS)
  }, [event, done])

  // A second hand of its own, so the estimate keeps counting down between
  // events. Without it a run that stalls looks like it is still nearly there.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (!event || event.phase !== 'progress' || total <= 0) return null

  const first = samples.current[0]
  const last = samples.current[samples.current.length - 1]
  // Two samples at least, and a real gap between them. One sample is not a rate,
  // and dividing by a zero interval produces Infinity, which renders as the word
  // "Infinity" in the middle of a sentence.
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
 * A duration a person reads at a glance.
 *
 * Deliberately coarse above a minute. "4 min" is what somebody wants from an
 * estimate built on a fifteen-second sample; "4 min 17 s" claims a precision the
 * measurement does not have, and it changes every second, which makes it harder
 * to read rather than easier.
 */
export function humanTime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}
