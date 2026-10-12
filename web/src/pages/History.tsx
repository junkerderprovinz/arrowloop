import { useEffect, useMemo, useRef, useState } from 'react'

import { Empty, Rows } from '../components/Shell'
import { Day, Field } from '../components/Field'
import { IconAction } from '../components/IconAction'
import { FilterButton, FilterChoice, ListBar, SearchFold } from '../components/ListBar'
import { RunSheet } from '../components/RunSheet'
import { Stats } from '../components/Stats'
import { TouchRow, touchKey } from '../components/TouchRow'
import { ViewSwitch, type LogView } from '../components/ViewSwitch'
import { Badge } from '../lib/glimstone/Badge'
import { Card } from '../lib/glimstone/Card'
import { api, type HistoryShow, type Job, type Run, type Touch } from '../lib/api'
import { dayTime } from '../lib/dayTime'
import { useT } from '../lib/i18n'
import { useLiveTick } from '../lib/liveTick'
import { useRemembered } from '../lib/remember'

/**
 * The kinds behind each choice of the file log's filter, grouped by what
 * somebody looks for. A `skip` carries the reason a path was not touched, and
 * there is no "error" kind, so trouble means conflict or skip.
 */
const SHOWS = {
  all: [] as string[],
  copied: ['copy', 'move'],
  gone: ['trash', 'rmdir'],
  trouble: ['conflict', 'skip'],
}

type Kind = keyof typeof SHOWS

const isLogView = (v: unknown): v is LogView => v === 'files' || v === 'runs'

/**
 * The History page: what the engine did, as the files it touched or as its
 * runs, behind one selector in one card. The filter and the search stand above
 * the card, and a run opens in a window.
 *
 * It fetches its own runs rather than filtering the shell's copy, which stays
 * unfiltered for the job list. Filters go to the server, since a job watching
 * a folder writes a run a minute and would push a daily job out of any fixed
 * window. While any job runs, both views ask again every second, and a running
 * run is listed with what it has done so far.
 */
export function History({
  runs,
  jobs,
}: {
  /** The shell's own unfiltered copy, used until this page's first answer lands. */
  runs: Run[]
  /** The job names to offer, including jobs with no runs yet. */
  jobs: Job[]
}) {
  const { t } = useT()
  // Files first: where a file went is the usual question.
  const [view, setView] = useRemembered<LogView>('arrowloop.history.view', 'files', isLogView)
  const tick = useLiveTick(jobs.some((j) => j.running))
  const [job, setJob] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [show, setShow] = useState<HistoryShow>('all')
  // Two calendar days bounding the runs; blank means open-ended.
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  // The box answers every keystroke; the engine only gets the settled query.
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250)
    return () => clearTimeout(timer)
  }, [typed])

  // Configuration and log joined: a renamed or deleted job still has runs, and
  // a job that never ran has none.
  const names = useMemo(() => {
    const seen = new Set<string>()
    for (const j of jobs) seen.add(j.name)
    for (const r of runs) seen.add(r.Job)
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [jobs, runs])

  const filtered = job !== '' || (view === 'files' ? kind !== 'all' : show !== 'all' || since !== '' || until !== '')

  return (
    <div className="flex flex-col gap-6">
      <ListBar>
        <FilterButton active={filtered}>
          <FilterChoice
            label={t('history.filterJob')}
            value={job}
            onChange={setJob}
            options={[{ value: '', label: t('history.allJobs') }, ...names.map((n) => ({ value: n, label: n }))]}
          />
          {view === 'files' ? (
            <FilterChoice<Kind>
              label={t('history.filterKind')}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: t('history.everything') },
                { value: 'copied', label: t('history.onlyCopied') },
                { value: 'gone', label: t('history.onlyGone') },
                { value: 'trouble', label: t('history.onlyTrouble') },
              ]}
            />
          ) : (
            <>
              <FilterChoice<HistoryShow>
                label={t('history.filterShow')}
                value={show}
                onChange={setShow}
                options={[
                  { value: 'all', label: t('history.showAll') },
                  { value: 'changed', label: t('history.showChanged') },
                  { value: 'failed', label: t('history.showFailed') },
                ]}
              />
              {/* Two free days rather than presets, since the day in question
                  is usually the day it went wrong. */}
              <div className="flex items-end gap-2">
                <Field label={t('history.since')}>
                  {/* A backwards range would look like an empty log. */}
                  <Day value={since} onChange={setSince} label={t('history.since')} max={until || undefined} />
                </Field>
                <Field label={t('history.until')}>
                  <Day value={until} onChange={setUntil} label={t('history.until')} />
                </Field>
                {(since || until) && (
                  <IconAction
                    title={t('history.rangeReset')}
                    labelKey="history.rangeReset"
                    onClick={() => {
                      setSince('')
                      setUntil('')
                    }}
                  />
                )}
              </div>
            </>
          )}
        </FilterButton>
        <SearchFold
          value={typed}
          onChange={setTyped}
          placeholder={view === 'files' ? t('history.pathHint') : t('history.runSearch')}
        />
      </ListBar>

      {/* The card reaches the bottom of the window however short its list. */}
      <div className="flex flex-1 flex-col *:flex-1">
        <Card title={t('history.title')} hueIndex={0}>
          <div className="w-full sm:max-w-xs">
            <ViewSwitch value={view} onChange={setView} />
          </div>
          {view === 'files' ? (
            <Touches job={job} kinds={SHOWS[kind]} query={query} tick={tick} />
          ) : (
            <RunList runs={runs} job={job} show={show} since={since} until={until} query={query} tick={tick} />
          )}
        </Card>
      </div>
    </div>
  )
}

/**
 * Every file the engine has touched, across jobs. All three filters apply in
 * the database, since the log runs to tens of thousands of rows and only a
 * screenful has arrived.
 */
function Touches({ job, kinds, query, tick }: { job: string; kinds: string[]; query: string; tick: number }) {
  const { t } = useT()
  const [touches, setTouches] = useState<Touch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(60)
  const end = useRef<HTMLLIElement | null>(null)

  // A new question starts again at one screenful.
  useEffect(() => setLimit(60), [job, query, kinds.join(',')])

  // The list runs with the page, so the next screenful comes when its end
  // scrolls into view. Only a list that filled the limit can have more.
  const more = touches !== null && touches.length >= limit
  useEffect(() => {
    const el = end.current
    if (!el || !more) return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((n) => n * 2)
    })
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [more, touches])

  useEffect(() => {
    let live = true
    api
      .log(job, kinds, query, limit)
      .then((got) => {
        if (!live) return
        setError(null)
        setTouches(got)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [job, kinds.join(','), query, limit, tick])

  if (error) return <p className="text-subline text-statusFail">{error}</p>
  if (!touches) return <Empty>{t('history.working')}</Empty>
  if (touches.length === 0) return <Empty>{query ? t('jobs.historyNoMatch', { q: query }) : t('history.logEmpty')}</Empty>

  return (
    <Rows className="flex flex-col">
      {touches.map((e) => (
        <TouchRow key={touchKey(e)} touch={e} withJob={!job} />
      ))}
      {more && <li ref={end} aria-hidden className="h-px" />}
    </Rows>
  )
}

/** Which run is open, by job and start as well as by id, since a running run's id changes when it is stored. */
type Opened = { id: number; job: string; started: string }

function RunList({
  runs,
  job,
  show,
  since,
  until,
  query,
  tick,
}: {
  runs: Run[]
  job: string
  show: HistoryShow
  since: string
  until: string
  query: string
  tick: number
}) {
  const { t } = useT()
  const [own, setOwn] = useState<Run[] | null>(null)
  const [loading, setLoading] = useState(false)
  // How many runs to ask for; doubles as the end of the list comes into view.
  const [limit, setLimit] = useState(50)
  const [open, setOpen] = useState<{ at: Opened; run: Run } | null>(null)
  const sentinel = useRef<HTMLDivElement | null>(null)

  useEffect(() => setLimit(50), [job, show, since, until])

  useEffect(() => {
    let live = true
    setLoading(true)
    api
      .history(job || undefined, show, limit, since, until, true)
      .then((got) => live && setOwn(got))
      .catch(() => live && setOwn([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [job, show, limit, since, until, runs, tick])

  const all = own ?? runs
  const needle = query.toLocaleLowerCase()
  const list = needle ? all.filter((r) => r.Job.toLocaleLowerCase().includes(needle) || r.Err.toLocaleLowerCase().includes(needle)) : all

  // Re-armed whenever the list changes, since the sentinel is then a new
  // element. The dependency on `loading` re-arms it too, so an answer that
  // lands with the sentinel still on screen asks again straight away.
  useEffect(() => {
    const end = sentinel.current
    if (!end) return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading) setLimit((n) => n * 2)
    })
    watcher.observe(end)
    return () => watcher.disconnect()
  }, [list.length, limit, loading])

  const matches = (r: Run, at: Opened) =>
    r.ID === at.id || (at.id < 0 && r.Job === at.job && Date.parse(r.Started) === Date.parse(at.started))
  const shownRun = open ? (all.find((r) => matches(r, open.at)) ?? open.run) : null
  const narrowed = job !== '' || show !== 'all' || since !== '' || until !== '' || query !== ''

  return (
    <>
      <Stats job={job || undefined} />
      {list.length === 0 ? (
        <Empty>{loading ? t('history.working') : narrowed ? t('history.noMatch') : t('history.empty')}</Empty>
      ) : (
        <Rows className="-mx-2 flex flex-col">
          {list.map((r) => (
            <RunRow
              key={`${r.Job}\n${r.Started}`}
              run={r}
              onOpen={() => setOpen({ at: { id: r.ID, job: r.Job, started: r.Started }, run: r })}
            />
          ))}
        </Rows>
      )}
      {/* An observed sentinel rather than scroll arithmetic, because the
          window scrolls, not a box of the list's own. Only present when the
          answer filled the limit. */}
      {all.length >= limit && (
        <div ref={sentinel} className="flex justify-center py-2 text-meta text-carbon-textMuted">
          {loading ? t('history.working') : ''}
        </div>
      )}
      {shownRun && <RunSheet run={shownRun} onClose={() => setOpen(null)} />}
    </>
  )
}

/**
 * One run as one row: the job, a badge for anything that went otherwise than
 * planned, and its time. A run that worked carries only the green dot.
 */
export function RunRow({ run: r, onOpen, withJob = true }: { run: Run; onOpen: () => void; withJob?: boolean }) {
  const { t, lang } = useT()
  // Only a run with nothing to report wears the green dot; the others say what went otherwise.
  const fine = !r.Running && !r.Err && r.Conflicts === 0 && r.Skipped === 0
  return (
    <li
      onClick={onOpen}
      className="glim-row flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 hover:bg-carbon-hover"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        className="min-w-0 flex-1 truncate text-start text-body text-carbon-text"
      >
        {withJob ? (
          <span className="font-medium">{r.Job}</span>
        ) : (
          <span className="flex items-center gap-1.5">
            {fine && <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-statusOkSolid" />}
            <span className="glim-num">{dayTime(r.Started, lang, (p) => t('list.when', p))}</span>
          </span>
        )}
      </button>
      {r.Running && (
        <Badge tone="active" className="glim-live">
          {t('status.running')}
        </Badge>
      )}
      {r.Err && <Badge tone="fail">{t('status.failed')}</Badge>}
      {r.Conflicts > 0 && <Badge tone="warn">{t('history.conflicts', { count: r.Conflicts })}</Badge>}
      {r.Skipped > 0 && <Badge tone="warn">{t('history.left', { count: r.Skipped })}</Badge>}
      {withJob && (
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-subline text-carbon-textSub">
          {fine && <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-statusOkSolid" />}
          <span className="glim-num">{dayTime(r.Started, lang, (p) => t('list.when', p))}</span>
        </span>
      )}
    </li>
  )
}
