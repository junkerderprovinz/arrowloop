import { useCallback, useEffect, useMemo, useState } from 'react'

import { IconPause, IconPencil, IconPlay, IconServer, IconStop } from '../components/glyphs'
import { placeOffers } from '../components/FolderPicker'
import { JobEditor, useConfigErrors, type EditedJobs } from '../components/JobEditor'
import { instanceNote } from '../components/OtherInstances'
import { RecentRun } from '../components/RecentRun'
import { Empty, Stack } from '../components/Shell'
import { api, type InstancePlaces, type Job, type OtherInstance, type RawJob, type Remote, type Settings } from '../lib/api'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { HostContext, otherHost } from '../lib/host'
import { useT } from '../lib/i18n'
import { jobStatus } from '../lib/jobList'
import { Places } from '../lib/places'
import { navigate } from '../lib/router'
import { remoteJobPath } from '../lib/routes'
import { useToast } from '../lib/toast'
import { JobHead } from './JobPage'

// How often the page asks the instance again, as its card on the Overview does.
const REFRESH_MS = 15_000

/**
 * A job of another instance of the group, opened from that instance's card:
 * the head of a job page marked with the instance it belongs to, with Pause,
 * Edit and Run now, and its last runs. A save goes to that instance, which
 * checks the job by its own rules. Its files, preview, checks and trash stay
 * on that instance's own page.
 */
export function RemoteJob({ instance, name, back }: { instance: string; name: string; back: string }) {
  const { t, lang } = useT()
  const push = useToast()
  const other = useOtherInstance(instance)
  const owner = other?.name ?? ''
  const edited = useInstanceJob(instance, name, (saved) => {
    push(t('job.savedOn', { name: owner }), 'success')
    other?.reload()
    if (saved !== name) navigate(remoteJobPath(instance, saved), { replace: true })
  })
  useConfigErrors(edited)
  const [editing, setEditing] = useState(false)
  const host = useMemo(() => otherHost(instance, owner, edited.places?.excludeSets ?? []), [instance, owner, edited.places])
  const places = useMemo(() => ({ jobs: [], drives: edited.places?.drives ?? [] }), [edited.places])

  if (other === undefined) {
    return (
      <Card title={name} hueIndex={0}>
        <Empty>{t('history.working')}</Empty>
      </Card>
    )
  }
  const job = other?.jobs?.find((j) => j.name === name)
  if (!other || other.state !== 'ok' || !job) {
    let note = t('job.missing')
    if (other && other.state !== 'ok') note = instanceNote(other, t, lang)
    else if (other) note = t('job.missingOn', { name: owner })
    return (
      <Card title={name} hueIndex={0}>
        <Empty>{note}</Empty>
      </Card>
    )
  }

  const stored = edited.stored
  return (
    <HostContext.Provider value={host}>
      <Places.Provider value={places}>
        <Stack>
          <JobHead
            job={job}
            status={jobStatus(job, { held: false, conflict: false, notes: false })}
            onBack={() => navigate(back)}
            mark={
              <Badge tone="active" size="small" className="gap-1 [&_svg]:h-3.5 [&_svg]:w-3.5">
                <IconServer aria-hidden />
                {t('job.onInstance', { name: owner })}
              </Badge>
            }
            actions={
              <>
                {stored && (
                  <Button
                    label={job.disabled ? t('jobs.resume') : t('jobs.pause')}
                    labelKey={job.disabled ? 'jobs.resume' : 'jobs.pause'}
                    glyph={job.disabled ? <IconPlay /> : <IconPause />}
                    disabled={edited.busy}
                    onClick={() => void edited.setDisabled(!job.disabled)}
                  />
                )}
                {stored && (
                  <Button label={t('job.edit')} labelKey="job.edit" glyph={<IconPencil />} onClick={() => setEditing(true)} />
                )}
                <RunOnInstance instance={other} job={job} onChanged={other.reload} />
              </>
            }
          />

          {edited.unread && (
            <p className={`text-subline ${edited.unread === 'older' ? 'text-carbon-textSub' : 'text-statusFail'}`}>
              {edited.unread === 'older' ? t('job.updateThere', { name: owner }) : edited.unread}
            </p>
          )}

          <Card title={t('activity.recent')} hint={t('job.elsewhere', { name: owner })} hueIndex={0}>
            {job.recent.length === 0 ? (
              <Empty>{t('history.empty')}</Empty>
            ) : (
              <ul className="flex flex-col gap-3">
                {job.recent.map((r) => (
                  <RecentRun key={r.ID} run={r} />
                ))}
              </ul>
            )}
          </Card>

          {editing && edited.jobs?.[0] && (
            <JobEditor config={edited} at={0} added={false} onClose={() => setEditing(false)} />
          )}
        </Stack>
      </Places.Provider>
    </HostContext.Provider>
  )
}

/** Run now or Cancel the run, on the instance the job belongs to. */
function RunOnInstance({ instance, job, onChanged }: { instance: OtherInstance; job: Job; onChanged: () => void }) {
  const { t } = useT()
  const push = useToast()
  const [busy, setBusy] = useState(false)

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
    <Button
      label={job.running ? t('jobs.cancelRun') : t('jobs.runNow')}
      labelKey={job.running ? 'jobs.cancelRun' : 'jobs.runNow'}
      glyph={job.running ? <IconStop /> : <IconPlay />}
      tone="accent"
      size="key"
      busy={busy}
      disabled={busy || (job.disabled && !job.running)}
      onClick={() => void press()}
    />
  )
}

/**
 * Instance id as the list of the group shows it, asked again every so often:
 * undefined until the list came, null when the group has no such instance.
 */
function useOtherInstance(id: string): (OtherInstance & { reload: () => void }) | null | undefined {
  const [list, setList] = useState<OtherInstance[] | undefined>(undefined)
  const reload = useCallback(() => {
    api
      .instances()
      .then(setList)
      .catch(() => setList([]))
  }, [])
  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [reload])
  if (list === undefined) return undefined
  const found = list.find((o) => o.id === id)
  return found ? { ...found, reload } : null
}

/**
 * An instance that answers a job's own address with "no such address" runs a
 * version from before jobs could be edited from another instance.
 */
function olderInstance(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith('no such address for the group')
}

/**
 * Job name of instance id, read and saved through the relay, in the shape the
 * job window edits. `stored` is the job as that instance last confirmed it,
 * which Pause writes from rather than from an edit nobody saved.
 */
function useInstanceJob(id: string, name: string, onSaved: (name: string) => void) {
  const { t } = useT()
  const [jobs, setJobs] = useState<RawJob[] | null>(null)
  const [stored, setStored] = useState<RawJob | null>(null)
  const [defaults, setDefaults] = useState<Settings['defaults']>(undefined)
  const [places, setPlaces] = useState<InstancePlaces | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Why the job could not be opened: 'older' for an instance from before
  // jobs could be edited from another one, else what went wrong.
  const [unread, setUnread] = useState('')

  useEffect(() => {
    let live = true
    api
      .instanceJob(id, name)
      .then((opened) => {
        if (!live) return
        setJobs([opened.job])
        setStored(opened.job)
        setDefaults(opened.defaults)
      })
      .catch((e) => {
        if (!live) return
        setUnread(olderInstance(e) ? 'older' : (e as Error).message)
      })
    api
      .instancePlaces(id)
      .then((got) => live && setPlaces(got))
      .catch(() => live && setPlaces(null))
    return () => {
      live = false
    }
  }, [id, name])

  const known = useMemo(() => placeOffers(places?.drives ?? [], places?.targets ?? [], t), [places, t])
  const remotes = useMemo<Remote[]>(() => (places?.targets ?? []).map((target) => ({ ...target, settings: [] })), [places])

  const patch = useCallback((at: number, next: Partial<RawJob>) => {
    setJobs((prev) => prev && prev.map((j, i) => (i === at ? { ...j, ...next } : j)))
  }, [])
  const replace = useCallback((at: number, job: RawJob) => {
    setJobs((prev) => prev && prev.map((j, i) => (i === at ? job : j)))
  }, [])

  const write = useCallback(
    async (job: RawJob) => {
      setBusy(true)
      setError(null)
      try {
        const saved = await api.saveInstanceJob(id, name, job)
        setJobs([saved.job])
        setStored(saved.job)
        setDefaults(saved.defaults)
        onSaved(saved.job.name ?? name)
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      } finally {
        setBusy(false)
      }
    },
    [id, name, onSaved],
  )

  const save = useCallback(async () => (jobs?.[0] ? write(jobs[0]) : false), [jobs, write])
  const setDisabled = useCallback((disabled: boolean) => (stored ? write({ ...stored, disabled }) : Promise.resolve(false)), [stored, write])

  const edited: EditedJobs = { jobs, known, remotes, defaults, busy, patch, replace, save }
  return { ...edited, error, stored, places, unread, setDisabled }
}
