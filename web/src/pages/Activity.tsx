import { useCallback, useEffect, useRef, useState } from 'react'

import { JobMark } from '../components/JobMark'
import { LOGO_GOLD, LogoMark } from '../components/LogoMark'
import { Num, Rule } from '../components/Shell'
import { ViewSwitch, type LogView } from '../components/ViewSwitch'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { api, type Job, type LatestRun, type RunEvent, type Touch, type Volume } from '../lib/api'
import { desk, inDesktopWindow, resizeFromEdges } from '../lib/desk'
import { entryLabel, entryRoute } from '../lib/entryLabel'
import { useT } from '../lib/i18n'
import { since } from '../lib/since'
import { wireTooltips } from '../lib/tooltip'

/**
 * How many file changes the small window asks for at first, a little more than
 * it shows at once. Scrolling to the end of the list asks for that many again.
 */
const CHANGES = 20

/**
 * Every job's newest run, counting its runs since this morning where the window
 * is, rather than where the engine is.
 */
function latestRuns(): Promise<LatestRun[]> {
  const morning = new Date()
  morning.setHours(0, 0, 0, 0)
  return api.latestRuns(morning.toISOString())
}

/**
 * The kinds that change a file. An agreed file and a weak check are lines in
 * the log but nothing happened to the file.
 */
const CHANGED = new Set(['copy', 'move', 'trash', 'mkdir', 'rmdir', 'conflict'])

const VIEW_KEY = 'arrowloop.trayView'

function storedView(): LogView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'files' ? 'files' : 'runs'
  } catch {
    return 'runs'
  }
}

function storeView(view: LogView) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Without storage the window opens on the runs, as it always did.
  }
}

/**
 * The small window at the tray icon: what is running, and either every job's
 * latest run or the latest file changes, with the pause, sync and open buttons. It
 * lives as long as the program and is only hidden between clicks, so it asks
 * the engine again whenever it gains the focus and otherwise follows the run
 * events alone, which keeps it light while it waits hidden.
 */
export function Activity() {
  const { t } = useT()
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<LatestRun[]>([])
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState<Record<string, RunEvent>>({})
  const [view, setView] = useState<LogView>(storedView)
  const [changes, setChanges] = useState<Touch[] | null>(null)
  const [drives, setDrives] = useState<Volume[]>([])
  const [pages, setPages] = useState(1)
  const end = useRef<HTMLLIElement | null>(null)
  // Read by the event handler, which is set up once.
  const viewing = useRef(view)
  viewing.current = view
  const paged = useRef(pages)
  paged.current = pages

  const refresh = useCallback(() => {
    void api.jobs().then(setJobs).catch(() => {})
    void desk.paused().then(setPaused).catch(() => {})
    if (viewing.current === 'files') {
      void api.log('', [], '', CHANGES * paged.current).then(setChanges).catch(() => {})
      void api
        .volumes()
        .then((v) => setDrives(v.volumes))
        .catch(() => {})
    } else {
      void latestRuns().then(setRuns).catch(() => {})
    }
  }, [])

  useEffect(refresh, [view, pages, refresh])

  // Only a list that filled what was asked for can have more; the runs are one
  // a job and come whole.
  const shown = view === 'files' ? (changes?.length ?? 0) : runs.length
  const more = view === 'files' && shown >= CHANGES * pages
  useEffect(() => {
    const el = end.current
    if (!el || !more) return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setPages((n) => n + 1)
    })
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [more, shown])

  useEffect(() => {
    wireTooltips()
    window.addEventListener('focus', refresh)
    // What the main window keeps in the browser is the language and the look,
    // and a reload takes a change over the same way a fresh start would.
    const follow = () => window.location.reload()
    window.addEventListener('storage', follow)
    const stop = api.watch((ev) => {
      if (ev.phase === 'moving') return
      if (ev.phase === 'progress') {
        setProgress((prev) => ({ ...prev, [ev.job]: ev }))
        // A change goes on top of the list the window last asked for. The
        // desktop app thins these events out, so a busy run shows a sample
        // of its files until the window is opened again.
        if (viewing.current === 'files' && ev.kind && ev.path && CHANGED.has(ev.kind)) {
          const heard: Touch = {
            Kind: ev.kind,
            Side: ev.side ?? '',
            Path: ev.path,
            Note: ev.note ?? '',
            Size: 0,
            Run: 0,
            Job: ev.job,
            When: new Date().toISOString(),
            Seq: ev.done ?? 0,
          }
          setChanges((prev) => [heard, ...(prev ?? [])].slice(0, CHANGES * paged.current))
        }
        return
      }
      setProgress((prev) => {
        const next = { ...prev }
        delete next[ev.job]
        return next
      })
      // The job list changes with a start or a finish, and so do the runs.
      void api.jobs().then(setJobs).catch(() => {})
      if (viewing.current === 'runs') {
        void latestRuns().then(setRuns).catch(() => {})
      }
    })
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', follow)
      stop()
    }
  }, [refresh])

  useEffect(() => (inDesktopWindow() ? resizeFromEdges() : undefined), [])

  const running = jobs.filter((j) => j.running)
  // Held jobs and drafts without both sides stay out, as on the phone.
  const ready = jobs.filter((j) => !j.disabled && !j.running && j.left && j.right)

  // A job taken out of the configuration keeps its runs in the history, but
  // not a row here.
  const latest = runs.filter((r) => jobs.some((j) => j.name === r.Job))

  const state = paused ? t('tray.paused') : running.length > 0 ? t('overview.running') : t('overview.idle')

  return (
    <div className="flex h-screen flex-col gap-3 overflow-hidden bg-carbon-background p-4 text-carbon-text">
      <header className="flex items-center gap-3">
        {/* The logo in its own gold whatever runs; the tray icon carries the
            status. */}
        <LogoMark size={28} className="shrink-0" style={{ color: LOGO_GOLD }} />
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

      <ViewSwitch
        value={view}
        onChange={(next) => {
          setView(next)
          setPages(1)
          storeView(next)
        }}
      />

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

        {view === 'runs' ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs text-carbon-textSub">{t('activity.recent')}</h2>
            {latest.length === 0 ? (
              <p className="text-xs text-carbon-textMuted">{t('history.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {latest.map((r) => (
                  <RunRow key={r.ID} run={r} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section className="flex flex-col gap-2">
            {changes !== null && changes.length === 0 ? (
              <p className="text-xs text-carbon-textMuted">{t('history.logEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(changes ?? []).map((c) => (
                  <ChangeRow key={`${c.Job}\n${c.When}\n${c.Seq}\n${c.Path}`} change={c} jobs={jobs} drives={drives} />
                ))}
                {more && <li ref={end} aria-hidden="true" className="h-px" />}
              </ul>
            )}
          </section>
        )}
      </div>

      <Rule />

      {/* One above the other, since side by side the longer translations of
          either label do not fit the window's width. */}
      <footer className="flex flex-col gap-2">
        <Button
          label={paused ? t('tray.resume') : t('tray.pause')}
          labelKey={paused ? 'tray.resume' : 'tray.pause'}
          tone="accent"
          hueIndex={1}
          className="w-full"
          onClick={() => void desk.setPaused(!paused).then(setPaused).catch(() => {})}
        />
        <Button
          label={t('tray.syncNow')}
          labelKey="tray.syncNow"
          tone="accent"
          hueIndex={2}
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

/**
 * One file change: what happened to it and when, in which job, and the full
 * path it came from and went to.
 */
function ChangeRow({ change, jobs, drives }: { change: Touch; jobs: Job[]; drives: Volume[] }) {
  const { t, lang } = useT()
  const job = jobs.find((j) => j.name === change.Job)
  const label = entryLabel(t, change, job, drives)
  const route = entryRoute(change, job, drives)
  const tone = change.Kind === 'conflict' ? 'warn' : 'neutral'
  const when = new Date(change.When)
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate" title={label}>
          <Badge tone={tone}>{label}</Badge>
        </span>
        <span className="ms-auto shrink-0 truncate text-xs text-carbon-textMuted" title={when.toLocaleString(lang)}>
          {change.Job} · {clock(when, lang)}
        </span>
      </div>
      {route ? (
        <>
          {route.from && (
            <span className="truncate font-mono text-xs text-carbon-textMuted" title={route.from}>
              {route.from}
            </span>
          )}
          <span className="truncate font-mono text-xs text-carbon-text" title={route.to}>
            {route.from ? (route.both ? '↔ ' : '→ ') : ''}
            {route.to}
          </span>
        </>
      ) : (
        <span className="truncate font-mono text-xs text-carbon-text" title={change.Path}>
          {change.Path}
        </span>
      )}
    </li>
  )
}

/** The time of day for today, and the date as well for anything older. */
function clock(at: Date, lang: string): string {
  const today = new Date()
  const sameDay = at.toDateString() === today.toDateString()
  return at.toLocaleString(lang, sameDay ? { hour: '2-digit', minute: '2-digit' } : { dateStyle: 'short', timeStyle: 'short' })
}

function RunRow({ run }: { run: LatestRun }) {
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
  // A job that runs on every change says how busy it was instead of filling
  // the list with its runs.
  const today = run.Since > 1 ? t('tray.runsToday', { count: run.Since }) : ''
  const said = failed ? run.Err : counts.length > 0 ? counts.join(' · ') : t('history.ok')
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
          {today ? `${said} · ${today}` : said}
        </span>
      </div>
    </li>
  )
}
