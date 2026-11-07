import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { IconPlay, IconStop } from './glyphs'
import { JobStatusLine } from './JobStatusLine'
import { RunStrip } from './RunStrip'
import { api, type Job, type OtherInstance } from '../lib/api'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { useT } from '../lib/i18n'
import { jobStatus } from '../lib/jobList'
import { kindName, seenAgo } from '../lib/pairing'
import { useToast } from '../lib/toast'

// How often the overview asks the other instances again. Their runs reach
// this one only by asking.
const REFRESH_MS = 15_000

/**
 * The jobs of every instance paired with this one, a card per instance. A job
 * there can be started or stopped from here, and everything else is changed on
 * the instance itself. Without another instance it draws `empty`.
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
        let note = ''
        if (other.state === 'approve') note = t('instances.approve')
        if (other.state === 'waiting') note = t('instances.waiting')
        if (other.state === 'away') note = t('instances.away', { time: seenAgo(lang, other.lastSeen ?? 0) })
        if (other.state === 'error') note = t('instances.error', { reason: other.error ?? '' })
        return (
          <Card key={other.id} title={other.name || kind} hint={i === 0 ? t('instances.hint') : undefined} hueIndex={firstHue + i}>
            <div className="flex flex-col gap-3">
              {kind && other.name && <p className="text-subline text-carbon-textMuted">{kind}</p>}
              {note && <p className="text-subline text-carbon-textSub">{note}</p>}
              {other.state === 'ok' && (other.jobs ?? []).length === 0 && (
                <p className="text-subline text-carbon-textMuted">{t('instances.noJobs')}</p>
              )}
              {other.state === 'ok' && (other.jobs ?? []).length > 0 && (
                <ul className="flex flex-col gap-2">
                  {(other.jobs ?? []).map((job) => (
                    <OtherJob key={job.name} instance={other} job={job} onChanged={load} />
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )
      })}
    </section>
  )
}

/** One job of another instance: its name, its last runs, its status and Run now or Cancel. */
function OtherJob({ instance, job, onChanged }: { instance: OtherInstance; job: Job; onChanged: () => void }) {
  const { t } = useT()
  const push = useToast()
  const [busy, setBusy] = useState(false)
  const status = jobStatus(job, { held: false, conflict: false, notes: false })

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
      <span className="min-w-0 flex-1 basis-40 text-body font-semibold text-carbon-text [overflow-wrap:anywhere]">{job.name}</span>
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
