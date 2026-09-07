import { IconJobs } from './glyphs'
import { useT } from '../lib/i18n'
import type { Job } from '../lib/api'

/**
 * A job's state, drawn as the mark the app is named for.
 *
 * jdp asked for "das logo wie in der taskleiste das sich bewegt wenn es laeuft
 * und sich nach zustand faerbt". The literal logo cannot do the second half:
 * `favicon.svg` is a multi-colour drawing, and a multi-colour drawing recoloured
 * to a status hue is not the logo any more, it is a smear. So this is the mark
 * the logo is BUILT from rather than the logo itself: the same two arrows going
 * opposite ways that the rail already carries as the Jobs glyph, in one colour,
 * which is exactly what a status mark needs to be.
 *
 * Four states, and each is a different question answered:
 *
 *   running   the accent, turning. The turn is the point: it says "right now"
 *             faster than any word on the card, and it is the only thing here
 *             that a still image cannot say.
 *   failed    the fail colour, still. The last run ended badly and nothing has
 *             happened since to say otherwise.
 *   paused    muted, still. Switched off on purpose, which is not a problem
 *             and must not look like one.
 *   ok        the ok colour, still.
 *
 * The turn reads --motion-turn-dur, so the motion setting reaches it like every
 * other animation in the app rather than running at one hard-coded speed.
 */

export type JobStatus = 'running' | 'failed' | 'paused' | 'ok'

/**
 * What a job's mark should say.
 *
 * Running wins over everything, including a previous failure: a job that is
 * working right now is not currently broken, whatever happened last time.
 * Paused beats failed for the same kind of reason in the other direction, since
 * a switched-off job is not going to fix its own last run.
 */
export function statusOf(job: Job, lastFailed: boolean): JobStatus {
  if (job.running) return 'running'
  if (job.disabled) return 'paused'
  if (lastFailed) return 'failed'
  return 'ok'
}

const INK: Record<JobStatus, string> = {
  running: 'text-accentInk',
  failed: 'text-statusFail',
  paused: 'text-carbon-textMuted',
  ok: 'text-statusOk',
}

const LABEL: Record<JobStatus, 'jobs.state.running' | 'jobs.state.failed' | 'jobs.state.disabled' | 'jobs.state.idle'> = {
  running: 'jobs.state.running',
  failed: 'jobs.state.failed',
  paused: 'jobs.state.disabled',
  ok: 'jobs.state.idle',
}

export function JobMark({ status, size = 20 }: { status: JobStatus; size?: number }) {
  const { t } = useT()
  const name = t(LABEL[status])

  return (
    <span
      className={`inline-flex shrink-0 items-center ${INK[status]}`}
      title={name}
      data-tip={name}
      aria-label={name}
      role="img"
    >
      {/* The turn is on the glyph rather than on this wrapper, so the tip's own
          box does not spin with it: a tooltip anchor that rotates is a tooltip
          that walks around the screen. */}
      <IconJobs
        width={size}
        height={size}
        className={status === 'running' ? 'al-turning shrink-0' : 'shrink-0'}
      />
    </span>
  )
}
