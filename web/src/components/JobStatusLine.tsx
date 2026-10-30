import type { MouseEvent } from 'react'

import { Badge } from '../lib/glimstone/Badge'
import { useAnomaliesOn } from '../lib/anomalyModule'
import type { Job, RunEvent } from '../lib/api'
import { dayTime } from '../lib/dayTime'
import { useGoTo, type Place } from '../lib/goTo'
import { useT } from '../lib/i18n'
import type { JobStatus } from '../lib/jobList'

/**
 * A job's one status, as its row and its page show it. A held run, a
 * conflict still waiting and a note are warnings that lead to where they are
 * answered; only a job with nothing waiting gets the quiet green dot and the
 * time of its last run.
 */
export function JobStatusLine({
  job,
  status,
  heldFinding,
  noteFinding,
  event,
}: {
  job: Job
  status: JobStatus
  /** The finding that holds the job, which the held badge leads to. */
  heldFinding?: string
  /** A finding about the job that does not hold it, which the warning opens. */
  noteFinding?: string
  /** The running job's progress, drawn as a bar under the badge. */
  event?: RunEvent
}) {
  const { t, lang } = useT()
  const goTo = useGoTo()
  const anomalies = useAnomaliesOn()
  // The status sits inside a row that opens the job, which a click on a
  // badge that leads elsewhere must not do as well.
  const lead = (e: MouseEvent, place: Place) => {
    e.stopPropagation()
    goTo(place)
  }

  switch (status) {
    case 'running': {
      const total = event?.total ?? 0
      const badge = (
        <Badge tone="active" className="glim-live">
          {t('status.running')}
        </Badge>
      )
      if (total === 0) return badge
      return (
        <span className="flex w-full flex-col items-end gap-1 max-[600px]:items-start">
          {badge}
          <span className="glim-meter h-1 w-24 overflow-hidden rounded-[var(--radius-pill)] bg-carbon-surface3" aria-hidden>
            <span className="block h-full bg-accent" style={{ width: `${Math.min(1, (event?.done ?? 0) / total) * 100}%` }} />
          </span>
        </span>
      )
    }
    case 'held':
      // Without the Anomalies page the held run is answered on the job's own page.
      return (
        <button
          type="button"
          onClick={(e) =>
            lead(e, anomalies === false ? { tab: 'jobs', job: job.name } : { tab: 'anomalies', job: job.name, finding: heldFinding })
          }
        >
          <Badge tone="warn">{t('status.held')}</Badge>
        </button>
      )
    case 'conflict':
      return (
        <button type="button" onClick={(e) => lead(e, { tab: 'conflicts', job: job.name })}>
          <Badge tone="warn">{t('status.conflict')}</Badge>
        </button>
      )
    case 'warned':
      // A run that skipped files has its answer on the job's own page, which
      // the row around the badge already opens.
      return noteFinding ? (
        <button type="button" onClick={(e) => lead(e, { tab: 'anomalies', job: job.name, finding: noteFinding })}>
          <Badge tone="warn">{t('status.warned')}</Badge>
        </button>
      ) : (
        <Badge tone="warn">{t('status.warned')}</Badge>
      )
    case 'failed':
      return <Badge tone="fail">{t('status.failed')}</Badge>
    case 'paused':
      return <Badge tone="neutral">{t('status.paused')}</Badge>
    case 'never':
      return <Badge tone="neutral">{t('status.never')}</Badge>
    default:
      return (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-subline text-carbon-textSub">
          <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-statusOkSolid" />
          <span className="glim-num">{dayTime(job.recent[0].Finished, lang, (p) => t('list.when', p))}</span>
        </span>
      )
  }
}
