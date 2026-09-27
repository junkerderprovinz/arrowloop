import { useCallback, useEffect, useState } from 'react'

import { JobMark } from '../components/JobMark'
import { LogoMark } from '../components/LogoMark'
import { Num, Rule } from '../components/Shell'
import { Button } from '../lib/glimstone/Button'
import { api, type Job, type Run, type RunEvent } from '../lib/api'
import { desk } from '../lib/desk'
import { useT } from '../lib/i18n'
import { since } from '../lib/since'
import { wireTooltips } from '../lib/tooltip'

/** How many finished runs the small window lists. */
const RECENT = 5

/**
 * The small window at the tray icon: what is running, the last few runs, and the
 * pause, sync and open buttons. It lives as long as the program and is only
 * hidden between clicks, so it refreshes whenever it gains the focus.
 */
export function Activity() {
  const { t } = useT()
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState<Record<string, RunEvent>>({})

  const refresh = useCallback(() => {
    void api.jobs().then(setJobs).catch(() => {})
    void api.history(undefined, 'all', RECENT).then(setRuns).catch(() => {})
    void desk.paused().then(setPaused).catch(() => {})
  }, [])

  useEffect(() => {
    wireTooltips()
    refresh()
    window.addEventListener('focus', refresh)
    // What the main window keeps in the browser is the language and the look,
    // and a reload takes a change over the same way a fresh start would.
    const follow = () => window.location.reload()
    window.addEventListener('storage', follow)
    const stop = api.watch((ev) => {
      if (ev.phase === 'moving') return
      if (ev.phase === 'progress') {
        setProgress((prev) => ({ ...prev, [ev.job]: ev }))
        return
      }
      setProgress((prev) => {
        const next = { ...prev }
        delete next[ev.job]
        return next
      })
      refresh()
    })
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', follow)
      stop()
    }
  }, [refresh])

  const running = jobs.filter((j) => j.running)
  // Held jobs and drafts without both sides stay out, as on the phone.
  const ready = jobs.filter((j) => !j.disabled && !j.running && j.left && j.right)

  const state = paused ? t('tray.paused') : running.length > 0 ? t('overview.running') : t('overview.idle')

  return (
    <div className="flex h-screen flex-col gap-3 overflow-hidden bg-carbon-background p-4 text-carbon-text">
      <header className="flex items-center gap-3">
        <LogoMark size={28} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">ArrowLoop</span>
          <span className={`truncate text-xs ${paused ? 'text-statusWarn' : 'text-carbon-textSub'}`}>{state}</span>
        </div>
        <Button
          label={t('tray.open')}
          labelKey="tray.open"
          tone="accent"
          onClick={() => void desk.open().catch(() => {})}
        />
      </header>

      <Rule />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {running.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs text-carbon-textSub">{t('overview.running')}</h2>
            <ul className="flex flex-col gap-2">
              {running.map((j) => (
                <RunningRow key={j.name} job={j} event={progress[j.name]} />
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-xs text-carbon-textSub">{t('activity.recent')}</h2>
          {runs.length === 0 ? (
            <p className="text-xs text-carbon-textMuted">{t('history.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {runs.map((r) => (
                <RunRow key={r.ID} run={r} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <Rule />

      {/* One above the other, since side by side the longer translations of
          either label do not fit the window's width. */}
      <footer className="flex flex-col gap-2">
        <Button
          label={paused ? t('tray.resume') : t('tray.pause')}
          labelKey={paused ? 'tray.resume' : 'tray.pause'}
          className="w-full"
          onClick={() => void desk.setPaused(!paused).then(setPaused).catch(() => {})}
        />
        <Button
          label={t('tray.syncNow')}
          labelKey="tray.syncNow"
          className="w-full"
          disabled={ready.length === 0}
          onClick={() => void Promise.allSettled(ready.map((j) => api.run(j.name))).finally(refresh)}
        />
      </footer>
    </div>
  )
}

function RunningRow({ job, event }: { job: Job; event?: RunEvent }) {
  const { t } = useT()
  const known = event?.phase === 'progress' && (event.total ?? 0) > 0
  return (
    <li className="flex items-start gap-2">
      <JobMark status="running" size={18} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm">{job.name}</span>
          <span className="ms-auto shrink-0 text-xs text-carbon-textMuted">
            {known ? t('progress.of', { done: event?.done ?? 0, total: event?.total ?? 0 }) : t('progress.starting')}
          </span>
        </div>
        {event?.path && <span className="truncate text-xs text-carbon-textMuted">{event.path}</span>}
      </div>
    </li>
  )
}

function RunRow({ run }: { run: Run }) {
  const { t, lang } = useT()
  const failed = run.Err !== ''
  const { count, unit } = since(run.Finished || run.Started)
  const parts = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).formatToParts(-count, unit)
  const counts = [
    run.Copied > 0 ? t('history.copied', { count: run.Copied }) : '',
    run.Moved > 0 ? t('history.moved', { count: run.Moved }) : '',
    run.Trashed > 0 ? t('history.trashed', { count: run.Trashed }) : '',
    run.Conflicts > 0 ? t('history.conflicts', { count: run.Conflicts }) : '',
  ].filter(Boolean)
  return (
    <li className="flex items-start gap-2">
      <JobMark status={failed ? 'failed' : 'ok'} size={18} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm">{run.Job}</span>
          <span className="ms-auto shrink-0 text-xs text-carbon-textMuted" title={new Date(run.Finished || run.Started).toLocaleString(lang)}>
            {parts.map((part, i) => (part.type === 'integer' ? <Num key={i}>{part.value}</Num> : part.value))}
          </span>
        </div>
        <span className={`truncate text-xs ${failed ? 'text-statusFail' : 'text-carbon-textMuted'}`}>
          {failed ? run.Err : counts.length > 0 ? counts.join(' · ') : t('history.ok')}
        </span>
      </div>
    </li>
  )
}
