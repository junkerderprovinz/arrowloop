import { LogoMark } from './LogoMark'
import { useT } from '../lib/i18n'
import type { Job } from '../lib/api'

/**
 * A job's state, drawn as the app's own logo.
 *
 * jdp asked for "das logo wie in der taskleiste das sich bewegt wenn es laeuft
 * und sich nach zustand faerbt", and this was the two-arrow GLYPH rather than
 * the logo, because the logo is a two-material drawing and painting the whole of
 * it one status colour leaves a smear rather than a mark. jdp answered the
 * objection instead of accepting it: "du kannst die ringe nach status einfaerbig
 * einfaerben."
 *
 * That is the better answer, and it works because the two materials say
 * different things. The arrow is the identity, so it keeps its own greys in
 * every state. The rings are decoration around it, so they can carry a colour
 * without the mark stopping being this mark. See LogoMark for the mechanism.
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
      data-tip={name}
      aria-label={name}
      role="img"
    >
      {/* The turn is on the drawing rather than on this wrapper, so the tip's
          own box does not spin with it: a tooltip anchor that rotates is a
          tooltip that walks around the screen. */}
      <LogoMark
        size={size}
        className={status === 'running' ? 'al-turning shrink-0' : 'shrink-0'}
      />
    </span>
  )
}
