import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { IconPlay, IconStop } from './glyphs'
import { JobStatusLine } from './JobStatusLine'
import { RecentRun } from './RecentRun'
import { RunStrip } from './RunStrip'
import { api, type Job, type OtherInstance } from '../lib/api'
import { dayTime } from '../lib/dayTime'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { useT, type Translate } from '../lib/i18n'
import { jobStatus, latestRuns } from '../lib/jobList'
import { kindName, seenAgo } from '../lib/pairing'
import { Link } from '../lib/router'
import { remoteJobPath } from '../lib/routes'
import { useToast } from '../lib/toast'

// How often the overview asks the other instances again. Their runs reach
// this one only by asking.
const REFRESH_MS = 15_000

/** How many of an instance's latest runs its card lists, as many as the Overview lists of this one. */
const RECENT = 5

/**
 * The jobs and latest runs of every instance paired with this one, a card per
 * instance laid out as this one's Overview lays out its own. A job there can be
 * started or stopped from here, and its name opens it to be edited. Without
 * another instance it draws `empty`.
 */
export function OtherInstances({ firstHue, empty = null }: { firstHue: number; empty?: ReactNode }) {
  const { t, lang } = useT()
  const [instances, setInstances] = useState<OtherInstance[]>([])

  const load = useCallback(() => {
    api
      .instances()
      .then(setInstances)
      // An engine that cannot be paired has no such list, which is no error.
      .catch(() => setInstances([]))
  }, [])

  useEffect(() => {
    load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  if (instances.length === 0) return empty
  return (
    <section className="flex flex-col gap-10" aria-label={t('instances.title')}>
      {instances.map((other, i) => {
        const kind = kindName(t, other.deployment)
        const note = instanceNote(other, t, lang)
        return (
          <Card key={other.id} title={other.name || kind} hint={i === 0 ? t('instances.hintOpen') : undefined} hueIndex={firstHue + i}>
            <div className="flex flex-col gap-3">
              {kind && other.name && <p className="text-subline text-carbon-textMuted">{kind}</p>}
              {note && <p className="text-subline text-carbon-textSub">{note}</p>}
              {other.state === 'ok' && (other.jobs ?? []).length === 0 && (
                <p className="text-subline text-carbon-textMuted">{t('instances.noJobs')}</p>
              )}
              {other.state === 'ok' && (other.jobs ?? []).length > 0 && <Insides instance={other} onChanged={load} />}
            </div>
          </Card>
        )
      })}
    </section>
  )
}

/** Why an instance shows no jobs, or nothing while it shows them. */
export function instanceNote(other: OtherInstance, t: Translate, lang: string): string {
  if (other.state === 'approve') return t('instances.approve')
  if (other.state === 'waiting') return t('instances.waiting')
  if (other.state === 'away') return t('instances.away', { time: seenAgo(lang, other.lastSeen ?? 0) })
  if (other.state === 'error') return t('instances.error', { reason: other.error ?? '' })
  return ''
}

/** An instance's jobs beside its latest runs, split as the Overview splits its own once the card is wide enough. */
function Insides({ instance, onChanged }: { instance: OtherInstance; onChanged: () => void }) {
  const { t } = useT()
  const jobs = instance.jobs ?? []
  const runs = latestRuns(jobs, RECENT)
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="glim-eyebrow">{t('nav.jobs')}</h3>
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <OtherJob key={job.name} instance={instance} job={job} onChanged={onChanged} />
            ))}
          </ul>
        </section>
        <section data-testid="instance-runs" className="flex min-w-0 flex-col gap-2">
          <h3 className="glim-eyebrow">{t('activity.recent')}</h3>
          {runs.length === 0 ? (
            <p className="text-subline text-carbon-textMuted">{t('history.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {runs.map((r) => (
                <RecentRun key={r.ID} run={r} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * One job of another instance: its name with when it ran last and runs next,
 * its last runs as a strip, its status and Run now or Cancel.
 */
function OtherJob({ instance, job, onChanged }: { instance: OtherInstance; job: Job; onChanged: () => void }) {
  const { t, lang } = useT()
  const push = useToast()
  const [busy, setBusy] = useState(false)
  const status = jobStatus(job, { held: false, conflict: false, notes: false })
  const when = (at: string) => dayTime(at, lang, (p) => t('list.when', p))
  // The status of a job that ran fine is already the time of that run.
  const last = status !== 'last' && job.recent[0]
  const next = job.nextRun && !job.disabled ? job.nextRun : ''

  async function press() {
    setBusy(true)
    try {
      if (job.running) {
        await api.stopOnInstance(instance.id, job.name)
      } else {
        await api.runOnInstance(instance.id, job.name)
        push(t('instances.started', { job: job.name, name: instance.name }), 'success')
      }
      onChanged()
    } catch (e) {
      push((e as Error).message, 'fail')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li data-job={job.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control bg-carbon-surface2 px-3 py-2">
      <span className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
        <Link
          to={remoteJobPath(instance.id, job.name)}
          className="self-start rounded-control text-body font-semibold text-carbon-text decoration-accent underline-offset-4 outline-none [overflow-wrap:anywhere] hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
        >
          {job.name}
        </Link>
        {(last || next) && (
          <span className="glim-num flex flex-wrap gap-x-3 text-subline text-carbon-textSub">
            {last && <span>{t('jobs.lastRun', { when: when(last.Finished || last.Started) })}</span>}
            {next && <span>{t('jobs.fact.next', { when: when(next) })}</span>}
          </span>
        )}
      </span>
      <RunStrip recent={job.recent} />
      <JobStatusLine job={job} status={status} />
      <Button
        label={job.running ? t('jobs.cancelRun') : t('jobs.runNow')}
        labelKey={job.running ? 'jobs.cancelRun' : 'jobs.runNow'}
        glyph={job.running ? <IconStop /> : <IconPlay />}
        busy={busy}
        disabled={busy || (job.disabled && !job.running)}
        onClick={() => void press()}
      />
    </li>
  )
}
