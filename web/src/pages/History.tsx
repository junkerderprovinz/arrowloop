import { useEffect, useMemo, useRef, useState } from 'react'

import { Empty, Rows } from '../components/Shell'
import { Day, Field } from '../components/Field'
import { IconAction } from '../components/IconAction'
import { FilterChoice, ListHead, ListSearch, Narrowed, type Head, type ListSort } from '../components/ListHead'
import { RunSheet } from '../components/RunSheet'
import { Stats } from '../components/Stats'
import { TOUCH_KINDS, TouchKindChoice, touchKindLabel, type TouchKind } from '../components/TouchKinds'
import { TouchRow, touchKey } from '../components/TouchRow'
import { ViewSwitch, type LogView } from '../components/ViewSwitch'
import { Badge } from '../lib/glimstone/Badge'
import { Card } from '../lib/glimstone/Card'
import { api, type HistoryShow, type Job, type Run, type Touch } from '../lib/api'
import { dayTime } from '../lib/dayTime'
import { useT, type TranslationKey } from '../lib/i18n'
import { useLiveTick } from '../lib/liveTick'
import { useRemembered } from '../lib/remember'
import { navigate } from '../lib/router'
import { SEVERITIES, findingOrder, type Finding, type Severity } from '../lib/anomalies'
import { matchesQuery } from '../lib/fold'
import { FindingCard } from '../components/FindingCard'
import { useColumns, type ColumnDef, type Columns } from '../lib/columns'
import { jobNamesInOrder } from '../lib/jobOrder'

const VIEW_KEY = 'arrowloop.history.view'
const isLogView = (v: unknown): v is LogView => v === 'files' || v === 'runs' || v === 'findings'

/** Opens History on the findings closed in the last thirty days, for the way there from Anomalies. */
export function openClosedFindings() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify('findings'))
  } catch {
    // Without storage History opens on its usual view.
  }
  navigate('/history')
}

const SEVERITY_LABEL: Record<Severity, TranslationKey> = {
  critical: 'anomaly.severity.critical',
  warning: 'anomaly.severity.warning',
  info: 'anomaly.severity.info',
}

/** The file log's columns at their built-in widths; the path takes the rest. */
export const FILE_COLUMNS: ColumnDef[] = [
  { id: 'what', width: 560, min: 200 },
  { id: 'when', width: 160, min: 96 },
  { id: 'job', width: 128, min: 64 },
  { id: 'size', width: 56, min: 48 },
  { id: 'path' },
]
const RUN_COLUMNS: ColumnDef[] = [{ id: 'job' }, { id: 'state', width: 240, min: 96 }, { id: 'when', width: 180, min: 120 }]

const SHOW_LABEL: Record<HistoryShow, TranslationKey> = {
  all: 'history.showAll',
  changed: 'history.showChanged',
  failed: 'history.showFailed',
}

/**
 * The History page: what the engine did, as the files it touched or as its
 * runs, behind one selector in one card. What narrows the list stands at the
 * end of the selector's row; the list filters and searches from its own head,
 * and a run opens in a window. Both views keep the log's own order, newest
 * first, which the engine hands out a screenful at a time, so no head sorts.
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
  closed,
  onFindingChanged,
}: {
  /** The shell's own unfiltered copy, used until this page's first answer lands. */
  runs: Run[]
  /** The job names to offer, including jobs with no runs yet. */
  jobs: Job[]
  /** The findings closed in the last thirty days, or null while Anomalies is switched off. */
  closed: Finding[] | null
  onFindingChanged: () => void
}) {
  const { t } = useT()
  // Files first: where a file went is the usual question.
  const [stored, setView] = useRemembered<LogView>(VIEW_KEY, 'files', isLogView)
  const view = stored === 'findings' && !closed ? 'files' : stored
  const [level, setLevel] = useState<Severity | ''>('')
  const [order, setOrder] = useState<ListSort>({ by: 'since', dir: 'desc' })
  const tick = useLiveTick(jobs.some((j) => j.running))
  const [job, setJob] = useState('')
  const [kind, setKind] = useState<TouchKind>('all')
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
  const area = useRef<HTMLDivElement>(null)
  const fileColumns = useColumns('history-files', FILE_COLUMNS)
  const runColumns = useColumns('history-runs', RUN_COLUMNS)

  // Configuration and log joined: a renamed or deleted job still has runs, and
  // a job that never ran has none.
  const names = useMemo(() => {
    const order = jobs.map((j) => j.name)
    return jobNamesInOrder([...order, ...runs.map((r) => r.Job)], order)
  }, [jobs, runs])

  const files = view === 'files'
  const findings = view === 'findings'
  const runsView = view === 'runs'
  const narrowing = [
    ...(job ? [t('list.onlyJob', { job })] : []),
    ...(files && kind !== 'all' ? [touchKindLabel(t, kind)] : []),
    ...(runsView && show !== 'all' ? [t(SHOW_LABEL[show])] : []),
    ...(runsView && since ? [`${t('history.since')} ${since}`] : []),
    ...(runsView && until ? [`${t('history.until')} ${until}`] : []),
    ...(findings && level ? [t(SEVERITY_LABEL[level])] : []),
    ...(typed.trim() ? [t('list.searched', { q: typed.trim() })] : []),
  ]
  function showAll() {
    setJob('')
    setKind('all')
    setShow('all')
    setSince('')
    setUntil('')
    setLevel('')
    setTyped('')
  }

  const jobFilter = {
    active: job !== '',
    panel: (
      <FilterChoice
        label={t('history.filterJob')}
        value={job}
        onChange={setJob}
        options={[{ value: '', label: t('history.allJobs') }, ...names.map((n) => ({ value: n, label: n }))]}
      />
    ),
  }
  const findingHeads: Head[] = [
    {
      id: 'severity',
      label: t('list.head.severity'),
      sorts: true,
      filter: {
        active: level !== '',
        panel: (
          <FilterChoice<Severity | ''>
            label={t('list.head.severity')}
            value={level}
            onChange={setLevel}
            options={[
              { value: '', label: t('anomalies.all') },
              ...SEVERITIES.map((sv) => ({ value: sv, label: t(SEVERITY_LABEL[sv]) })),
            ]}
          />
        ),
      },
    },
    { id: 'job', label: t('history.filterJob'), sorts: true, filter: jobFilter },
    { id: 'since', label: t('anomaly.closedLabel'), sorts: true },
  ]
  const heads: Head[] = findings
    ? findingHeads
    : files
    ? [
        {
          id: 'what',
          label: t('history.filterKind'),
          className: 'w-[35rem] shrink-0 max-md:w-72 max-sm:w-auto',
          filter: { active: kind !== 'all', panel: <TouchKindChoice value={kind} onChange={setKind} /> },
        },
        { id: 'when', label: t('list.head.when'), className: 'w-40 shrink-0 max-sm:hidden' },
        { id: 'job', label: t('history.filterJob'), className: 'w-32 shrink-0 max-md:hidden', filter: jobFilter },
        { id: 'size', label: t('list.head.size'), className: 'w-14 shrink-0 max-sm:hidden' },
        { id: 'path', label: t('list.head.path'), className: 'min-w-0 flex-1 max-sm:hidden' },
      ]
    : [
        { id: 'job', label: t('history.filterJob'), className: 'min-w-0 flex-1', filter: jobFilter },
        {
          id: 'state',
          label: t('list.head.state'),
          className: 'shrink-0',
          filter: {
            active: show !== 'all',
            panel: (
              <FilterChoice<HistoryShow>
                label={t('history.filterShow')}
                value={show}
                onChange={setShow}
                options={(['all', 'changed', 'failed'] as const).map((value) => ({ value, label: t(SHOW_LABEL[value]) }))}
              />
            ),
          },
        },
        {
          id: 'when',
          label: t('list.head.when'),
          className: 'shrink-0',
          end: true,
          filter: {
            active: since !== '' || until !== '',
            panel: (
              // Two free days rather than presets, since the day in question
              // is usually the day it went wrong.
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
            ),
          },
        },
      ]

  return (
    // The card reaches the bottom of the window however short its list.
    <div className="flex flex-1 flex-col *:flex-1">
      <Card title={t('history.title')} hueIndex={0}>
        <div data-new="list-bar" className="flex flex-wrap items-center gap-2">
          <div data-new="closed-findings" className="min-w-0 flex-1 basis-48 sm:max-w-sm">
            <ViewSwitch value={view} onChange={setView} findings={closed !== null} />
          </div>
          <div className="ms-auto">
            <Narrowed what={narrowing} onClear={showAll} />
          </div>
        </div>
        {runsView && <Stats job={job || undefined} />}
        <div
          ref={(el) => {
            area.current = el
            fileColumns.host.current = el
            runColumns.host.current = el
          }}
          tabIndex={-1}
          data-new="list-heads"
          style={files ? fileColumns.style : runsView ? runColumns.style : undefined}
          className="relative flex flex-col gap-2 outline-none"
        >
          <ListSearch
            value={typed}
            onChange={setTyped}
            placeholder={files ? t('history.pathHint') : t('history.runSearch')}
            area={area}
          />
          {findings ? (
            <ListHead heads={heads} sort={order} onSort={setOrder} page="history" search />
          ) : (
            <ListHead heads={heads} page="history" search columns={files ? fileColumns : runColumns} />
          )}
          {findings ? (
            <ClosedFindings
              findings={(closed ?? [])
                .filter((f) => (!job || f.job === job) && (!level || f.severity === level))
                .filter((f) => !query || matchesQuery(query, [f.job, f.detail ?? '', ...(f.paths ?? [])]))
                .sort(findingOrder(order))}
              narrowed={narrowing.length > 0}
              onChanged={onFindingChanged}
            />
          ) : files ? (
            <Touches job={job} kinds={TOUCH_KINDS[kind]} query={query} tick={tick} columns={fileColumns} />
          ) : (
            <RunList runs={runs} job={job} show={show} since={since} until={until} query={query} tick={tick} columns={runColumns} />
          )}
        </div>
      </Card>
    </div>
  )
}

/** The findings closed in the last thirty days, each as the card Anomalies draws, with how it ended. */
function ClosedFindings({ findings, narrowed, onChanged }: { findings: Finding[]; narrowed: boolean; onChanged: () => void }) {
  const { t } = useT()
  if (findings.length === 0) return <Empty>{narrowed ? t('list.noneShown') : t('anomaly.noneClosed')}</Empty>
  return (
    <ul className="flex flex-col gap-2.5">
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} lead={false} onChanged={onChanged} onAllowed={() => undefined} />
      ))}
    </ul>
  )
}

/**
 * Every file the engine has touched, across jobs. All three filters apply in
 * the database, since the log runs to tens of thousands of rows and only a
 * screenful has arrived.
 */
function Touches({
  job,
  kinds,
  query,
  tick,
  columns,
}: {
  job: string
  kinds: string[]
  query: string
  tick: number
  columns: Columns
}) {
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
        <TouchRow key={touchKey(e)} touch={e} withJob={!job} columns={columns} />
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
  columns,
}: {
  runs: Run[]
  job: string
  show: HistoryShow
  since: string
  until: string
  query: string
  tick: number
  columns: Columns
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
      {list.length === 0 ? (
        <Empty>{loading ? t('history.working') : narrowed ? t('history.noMatch') : t('history.empty')}</Empty>
      ) : (
        <Rows className="-mx-2 flex flex-col">
          {list.map((r) => (
            <RunRow
              key={`${r.Job}\n${r.Started}`}
              run={r}
              columns={columns}
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
export function RunRow({
  run: r,
  onOpen,
  withJob = true,
  columns,
}: {
  run: Run
  onOpen: () => void
  withJob?: boolean
  /** The list's column layout, which only History's runs have. */
  columns?: Columns
}) {
  const { t, lang } = useT()
  // Only a run with nothing to report wears the green dot; the others say what went otherwise.
  const fine = !r.Running && !r.Err && r.Conflicts === 0
  return (
    <li
      onClick={onOpen}
      className={`glim-row flex min-h-11 cursor-pointer items-center gap-x-3 gap-y-1 rounded-control px-2 py-1.5 hover:bg-carbon-hover max-sm:flex-wrap${
        columns ? ' md:grid md:[grid-template-columns:var(--list-cols)]' : ''
      }`}
    >
      <button
        type="button"
        style={columns?.cell('job')}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        className={`min-w-0 flex-1 text-start text-body text-carbon-text [overflow-wrap:anywhere]${columns ? ' md:truncate' : ''}`}
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
      {/* One cell for the badges where the row has columns, none of its own otherwise. */}
      <span style={columns?.cell('state')} className={columns ? 'flex min-w-0 flex-wrap items-center gap-1.5 md:flex-nowrap md:overflow-hidden' : 'contents'}>
        {r.Running && (
          <Badge tone="active" className="glim-live">
            {t('status.running')}
          </Badge>
        )}
        {r.Err && <Badge tone="fail">{t('status.failed')}</Badge>}
        {r.Conflicts > 0 && <Badge tone="warn">{t('history.conflicts', { count: r.Conflicts })}</Badge>}
        {r.Skipped > 0 && <Badge>{t('history.left', { count: r.Skipped })}</Badge>}
      </span>
      {withJob && (
        <span
          style={columns?.cell('when')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap text-subline text-carbon-textSub${columns ? ' md:justify-end' : ''}`}
        >
          {fine && <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-statusOkSolid" />}
          <span className="glim-num">{dayTime(r.Started, lang, (p) => t('list.when', p))}</span>
        </span>
      )}
    </li>
  )
}
