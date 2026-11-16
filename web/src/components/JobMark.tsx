import { LogoMark } from './LogoMark'
import { useT, type TranslationKey } from '../lib/i18n'
import type { Job } from '../lib/api'

/**
 * A job's state, drawn as the app's logo with its rings in the status colour.
 * The arrow keeps its greys, since it is what makes the logo recognisable. A
 * running job's mark turns; paused and stopped are muted rather than alarming.
 */

export type JobStatus = 'running' | 'failed' | 'paused' | 'stopped' | 'ok'

/**
 * What a job's mark should say. Running beats a previous failure, and paused
 * beats failed because a switched-off job will not fix its own last run.
 */
export function statusOf(job: Job, lastFailed: boolean): JobStatus {
  if (job.running) return 'running'
  if (job.disabled) return 'paused'
  if (lastFailed) return 'failed'
  return 'ok'
}

const INK: Record<JobStatus, string> = {
  running: 'text-accentGlyph',
  failed: 'text-statusFail',
  paused: 'text-carbon-textMuted',
  stopped: 'text-carbon-textMuted',
  ok: 'text-statusOk',
}

const LABEL: Record<JobStatus, TranslationKey> = {
  running: 'status.running',
  failed: 'status.failed',
  paused: 'status.paused',
  stopped: 'status.stopped',
  ok: 'status.ready',
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
      {/* The drawing turns rather than the wrapper, so the tooltip anchor
          stays put. */}
      <LogoMark
        size={size}
        className={status === 'running' ? 'al-turning shrink-0' : 'shrink-0'}
      />
    </span>
  )
}
