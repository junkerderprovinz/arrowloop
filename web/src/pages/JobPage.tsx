import { useEffect, useState, type ReactNode } from 'react'

import { CheckPanel } from '../components/CheckPanel'
import { DirectionGlyph, DirectionMark } from '../components/Direction'
import { DupesPanel } from '../components/DupesPanel'
import { FindingCard } from '../components/FindingCard'
import { IconPause, IconPencil, IconPlay, IconPreview, IconTrash } from '../components/glyphs'
import { BrakesCard } from '../components/JobBrakes'
import { JobEditor, useConfigErrors } from '../components/JobEditor'
import { JobStatusLine } from '../components/JobStatusLine'
import { ListBar, SearchFold } from '../components/ListBar'
import { Menu } from '../components/Menu'
import { Pace } from '../components/Pace'
import { RunSheet } from '../components/RunSheet'
import { Empty, Rows, Stack } from '../components/Shell'
import { ToggleRow } from '../components/ToggleRow'
import { TouchRow, touchKey } from '../components/TouchRow'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { amount, type JobLearning } from '../lib/anomalies'
import { useAnomaliesOn } from '../lib/anomalyModule'
import { api, type Job, type Run, type RunEvent, type Touch } from '../lib/api'
import { describeCadence, readCadence } from '../lib/cadence'
import { dayTime } from '../lib/dayTime'
import { sideName } from '../lib/entryLabel'
import { useGoTo } from '../lib/goTo'
import { translateSide, useT } from '../lib/i18n'
import { jobStatus } from '../lib/jobList'
import { useLive } from '../lib/live'
import { useLiveTick } from '../lib/liveTick'
import { usePlaces } from '../lib/places'
import { stageKey } from '../lib/readingStage'
import { useToast } from '../lib/toast'
import { useJobConfig } from './Editor'
import { PreviewPlan } from './Preview'
import { RunRow } from './History'

/**
 * One job's own page: a flat header with its name, one line of state, its
 * status and its actions, and under it a card for each thing that can be done
 * with or learnt about the job. Nothing on it folds out.
 */
export function JobPage({ name }: { name: string }) {
  const { t } = useT()
  const push = useToast()
  const goTo = useGoTo()
  const live = useLive()
  const anomalies = useAnomaliesOn()
  const config = useJobConfig(live.onSaved)
  useConfigErrors(config)
  const [editing, setEditing] = useState<{ at: number; added: boolean } | null>(null)
  const [removing, setRemoving] = useState(false)
  // A removed job's state database is deleted by default. Keeping it is for a
  // pair that is coming back, so its files do not all count as new.
  const [dropState, setDropState] = useState(true)

  const job = live.jobs.find((j) => j.name === name)
  const at = config.jobs?.findIndex((j) => j.name === name) ?? -1
  const findings = live.findings.filter((f) => f.job === name)
  const held = findings.find((f) => f.held)
  const notes = findings.filter((f) => !f.held)

  if (!job) {
    return (
      <Card title={name} hueIndex={0}>
        <Empty>{live.jobs.length === 0 ? t('history.working') : t('job.missing')}</Empty>
      </Card>
    )
  }

  const status = jobStatus(job, { held: !!held, conflict: live.conflicted.includes(name), notes: notes.length > 0 })

  return (
    <Stack>
      <Head
        job={job}
        status={status}
        notes={notes.length}
        heldFinding={held?.id}
        noteFinding={notes[0]?.id}
        actions={
          <>
            {at !== -1 && (
              <Button
                label={job.disabled ? t('jobs.resume') : t('jobs.pause')}
                labelKey={job.disabled ? 'jobs.resume' : 'jobs.pause'}
                glyph={job.disabled ? <IconPlay /> : <IconPause />}
                disabled={config.busy}
                onClick={() => void config.setDisabled(job.name, !job.disabled)}
              />
            )}
            {at !== -1 && (
              <Button
                label={t('job.edit')}
                labelKey="job.edit"
                glyph={<IconPencil />}
                onClick={() => setEditing({ at, added: false })}
              />
            )}
            {at !== -1 && (
              <Menu
                label={t('list.more')}
                labelKey="list.more"
                items={[
                  {
                    label: t('edit.duplicate'),
                    labelKey: 'edit.duplicate',
                    onSelect: () => setEditing({ at: config.duplicate(at), added: true }),
                  },
                  { label: t('edit.openTrash'), labelKey: 'edit.openTrash', onSelect: () => goTo({ tab: 'trash', job: name }) },
                  { label: t('edit.remove'), labelKey: 'edit.remove', onSelect: () => setRemoving(true) },
                ]}
              />
            )}
            {/* What the page is for, so it is its one filled button, the way
                forward at the end of the row. */}
            <Button
              label={job.running ? t('jobs.cancelRun') : t('jobs.runNow')}
              labelKey={job.running ? 'jobs.cancelRun' : 'jobs.runNow'}
              title={job.running ? undefined : t('jobs.runNowHint')}
              tone="accent"
              className="glim-btn-key"
              onClick={() => {
                const asked = job.running ? api.stopJob(job.name) : api.run(job.name)
                asked.catch((e: Error) => push(e.message, 'fail'))
              }}
            />
          </>
        }
      />

      {/* Without the Anomalies page a held run is answered here. */}
      {anomalies === false && held && (
        <Card title={t('anomaly.held')} hueIndex={6}>
          <ul className="flex flex-col">
            <FindingCard finding={held} onJobPage onChanged={live.onSaved} />
          </ul>
        </Card>
      )}
      <RunsCard job={job} event={live.progress[name]} speed={live.speeds[name]} />
      <FilesCard job={job} />
      <PreviewCard job={name} onDone={live.onSaved} />
      <Card title={t('jobs.check')} hueIndex={3}>
        <CheckPanel job={name} />
      </Card>
      <Card title={t('jobs.dupes')} hueIndex={4}>
        <DupesPanel job={name} />
      </Card>
      {at !== -1 && <BrakesCard job={name} config={config} hueIndex={5} />}
      {anomalies !== false && <UsualCard job={name} lastRun={job.recent[0]?.ID} />}

      {editing && config.jobs?.[editing.at] && (
        <JobEditor config={config} at={editing.at} added={editing.added} onClose={() => setEditing(null)} />
      )}

      {removing && config.jobs?.[at] && (
        <ConfirmDialog
          title={t('edit.removeJob')}
          message={t('edit.removeStakes', { name })}
          confirmLabel={t('confirm.delete')}
          confirmGlyph={<IconTrash />}
          cancelLabel={t('confirm.cancel')}
          extra={
            <ToggleRow
              label={t('edit.removeState')}
              hint={t('edit.removeStateHint')}
              checked={dropState}
              onChange={setDropState}
              hueIndex={0}
            />
          }
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false)
            void config.remove(at, dropState, name, () => goTo({ tab: 'jobs', job: '' }))
          }}
        />
      )}
    </Stack>
  )
}

/**
 * The page's head, standing on the page with no card around it: the tile of
 * the job's direction, its name, one line on what it joins and when it runs,
 * its status and its actions.
 */
function Head({
  job,
  status,
  notes,
  heldFinding,
  noteFinding,
  actions,
}: {
  job: Job
  status: ReturnType<typeof jobStatus>
  notes: number
  heldFinding?: string
  noteFinding?: string
  actions: ReactNode
}) {
  const { t, lang } = useT()
  const goTo = useGoTo()
  const { drives } = usePlaces()
  const when = (at: string) => dayTime(at, lang, (p) => t('list.when', p))

  return (
    <div data-new="job-page" className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <span className="glim-row-glyph flex h-10 w-10 shrink-0 items-center justify-center rounded-control [&_svg]:h-5 [&_svg]:w-5">
        <DirectionGlyph direction={job.direction} />
      </span>
      <div className="flex min-w-0 flex-1 basis-[28rem] flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="min-w-0 text-status font-semibold text-carbon-text [overflow-wrap:anywhere]">{job.name}</h1>
          {/* A count leads to what it counts. */}
          {notes > 0 && (
            <button type="button" onClick={() => goTo({ tab: 'anomalies', job: job.name })}>
              <Badge tone="warn">{t('job.notes', { count: notes })}</Badge>
            </button>
          )}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 text-subline text-carbon-textSub">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span className="min-w-0 [overflow-wrap:anywhere]">{sideName(job.left, drives)}</span>
            <DirectionMark direction={job.direction} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{sideName(job.right, drives)}</span>
          </span>
          <span>{t('jobs.runs', { cadence: describeCadence(readCadence(job.schedule ?? '', !!job.watch), t) })}</span>
          {job.nextRun && !job.disabled && <span>{t('jobs.fact.next', { when: when(job.nextRun) })}</span>}
        </span>
      </div>
      <span className="flex shrink-0 items-center">
        <JobStatusLine job={job} status={status} heldFinding={heldFinding} noteFinding={noteFinding} />
      </span>
      <span className="flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</span>
    </div>
  )
}

/**
 * What a run of the job usually does, once enough runs were learned from to
 * say. Asked again after each run, which is what moves the ranges.
 */
function UsualCard({ job, lastRun }: { job: string; lastRun?: number }) {
  const { t } = useT()
  const [learned, setLearned] = useState<JobLearning | null>(null)

  useEffect(() => {
    let live = true
    api
      .learning()
      .then((all) => live && setLearned(all.find((l) => l.job === job) ?? null))
      .catch(() => live && setLearned(null))
    return () => {
      live = false
    }
  }, [job, lastRun])

  if (!learned?.usual?.length) return null
  return (
    <Card title={t('job.usual')} hint={t('job.usualHint')} hueIndex={6}>
      <ul className="flex flex-col gap-1 text-body text-carbon-text">
        {learned.usual.map((u) => (
          <li key={u.figure} className="glim-num">
            {t(`job.usual.${u.figure}`, { low: amount(u.figure, u.low, t), high: amount(u.figure, u.high, t) })}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** The job's runs, newest first, with what a running one is doing right now. */
function RunsCard({ job, event, speed }: { job: Job; event?: RunEvent; speed?: number }) {
  const { t } = useT()
  const tick = useLiveTick(job.running)
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [limit, setLimit] = useState(20)
  const [open, setOpen] = useState<Run | null>(null)

  useEffect(() => {
    let live = true
    api
      .history(job.name, 'all', limit, '', '', true)
      .then((got) => live && setRuns(got))
      .catch(() => live && setRuns([]))
    return () => {
      live = false
    }
  }, [job.name, limit, tick, job.recent[0]?.ID])

  const shown = open ? (runs?.find((r) => r.ID === open.ID || (open.ID < 0 && r.Started === open.Started)) ?? open) : null

  return (
    <Card title={t('job.runs')} hueIndex={0}>
      {job.running && <Now event={event} speed={speed} />}
      {runs === null ? (
        <Empty>{t('history.working')}</Empty>
      ) : runs.length === 0 ? (
        <Empty>{t('jobs.historyEmpty')}</Empty>
      ) : (
        <Rows className="-mx-2 flex flex-col">
          {runs.map((r) => (
            <RunRow key={`${r.Started}`} run={r} withJob={false} onOpen={() => setOpen(r)} />
          ))}
        </Rows>
      )}
      {runs !== null && runs.length >= limit && (
        <div className="flex justify-center">
          <Button label={t('job.moreRuns')} labelKey="job.moreRuns" onClick={() => setLimit((n) => n * 2)} />
        </div>
      )}
      {shown && <RunSheet run={shown} onClose={() => setOpen(null)} />}
    </Card>
  )
}

/**
 * What a running job is doing: the stage while it reads, the file it is on,
 * a bar in the accent, and its pace. A listing measured against the last run
 * stops short of full, since this run may hold more; with nothing to measure
 * against the bar is indeterminate.
 */
function Now({ event, speed }: { event?: RunEvent; speed?: number }) {
  const { t, lang } = useT()
  const total = event?.total ?? 0
  const done = event?.done ?? 0
  const known = total > 0
  const share = known ? Math.min(event?.guess ? 0.99 : 1, done / total) : 0
  const format = new Intl.NumberFormat(lang)
  const counts = { done: format.format(done), total: format.format(total) }

  let words = t('progress.starting')
  if (known) words = t(event?.guess ? 'progress.about' : 'progress.of', counts)
  else if (event?.stage) words = t('progress.found', counts)

  return (
    <section className="glim-well flex flex-col gap-1.5 rounded-card p-4" aria-live="polite">
      {event?.stage && <p className="text-subline text-carbon-textSub">{t(stageKey(event.stage, event.side))}</p>}
      {event?.path && (
        <p className="flex min-w-0 items-center gap-1.5 text-subline text-carbon-textMuted">
          <span className="truncate font-mono" title={event.path}>
            {event.path}
          </span>
          {event.side && <span className="shrink-0">{translateSide(t, event.side as 'left' | 'right')}</span>}
        </p>
      )}
      <div className="flex items-center gap-2">
        <div
          className="h-1 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-carbon-surface3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={known ? total : undefined}
          aria-valuenow={known ? done : undefined}
        >
          <div
            className={`h-full bg-accent transition-[width] ${known ? '' : 'glim-indeterminate'}`}
            style={{ width: known ? `${share * 100}%` : '35%' }}
          />
        </div>
        <span className="shrink-0 text-meta tabular-nums text-carbon-textMuted">{words}</span>
      </div>
      <Pace event={event} speed={speed} />
    </section>
  )
}

/**
 * What the job has done to individual files, newest first, with its own
 * search above the card. While the job runs it asks again every second, and
 * the engine answers with the running run's lines among the stored ones.
 */
function FilesCard({ job }: { job: Job }) {
  const { t } = useT()
  const tick = useLiveTick(job.running)
  const [touches, setTouches] = useState<Touch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(60)
  // The box answers every keystroke; the engine only gets the settled query.
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')

  // Without the pause, each keystroke is a query and out-of-order answers can
  // leave the list showing the results for a prefix.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250)
    return () => clearTimeout(timer)
  }, [typed])
  useEffect(() => setLimit(60), [query])

  useEffect(() => {
    let live = true
    api
      .jobTouches(job.name, limit, query)
      .then((got) => {
        if (!live) return
        setError(null)
        setTouches(got)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [job.name, limit, query, tick])

  return (
    <div className="flex flex-col gap-6">
      <ListBar>
        <SearchFold value={typed} onChange={setTyped} placeholder={t('jobs.historySearch')} />
      </ListBar>
      <Card title={t('job.files')} hueIndex={1}>
        {error ? (
          <p className="text-subline text-statusFail">{error}</p>
        ) : !touches ? (
          <Empty>{t('jobs.historyLoading')}</Empty>
        ) : touches.length === 0 ? (
          <Empty>{query ? t('jobs.historyNoMatch', { q: query }) : t('jobs.historyEmpty')}</Empty>
        ) : (
          // Loads more near the bottom; 40px rather than the exact end, which a
          // trackpad stops a pixel or two short of.
          <ul
            className="flex max-h-96 flex-col overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollHeight - el.scrollTop - el.clientHeight > 40) return
              // A list shorter than the limit is the whole list.
              if (touches.length >= limit) setLimit((n) => n * 2)
            }}
          >
            {touches.map((e) => (
              <TouchRow key={touchKey(e)} touch={e} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** What a run would do, worked out on request and shown in its card with the rows to leave out. */
function PreviewCard({ job, onDone }: { job: string; onDone: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  return (
    <Card title={t('jobs.preview')} hint={t('job.previewHint')} hueIndex={2}>
      {open ? (
        <PreviewPlan
          job={job}
          onDone={() => {
            setOpen(false)
            onDone()
          }}
        />
      ) : (
        <div className="flex justify-end">
          <Button label={t('job.previewStart')} labelKey="job.previewStart" glyph={<IconPreview />} onClick={() => setOpen(true)} />
        </div>
      )}
    </Card>
  )
}
