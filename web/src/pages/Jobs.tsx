import { useEffect, useMemo, useRef, useState } from 'react'

import { Empty, Num, Rule, Stack } from '../components/Shell'
import { IconAction } from '../components/IconAction'
import { ToggleRow } from '../components/ToggleRow'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { IconAdd, IconCopy, IconDelete, IconEdit, IconPause, IconRun, IconSave, IconToLeft, IconToRight } from '../components/glyphs'
import { DirectionMark } from '../components/Direction'
import { JobMark, statusOf } from '../components/JobMark'
import { Pace } from '../components/Pace'
import { RunDetail } from '../components/RunDetail'
import { Stats } from '../components/Stats'
import { CheckPanel } from '../components/CheckPanel'
import { DupesPanel } from '../components/DupesPanel'
import { TrashPanel } from '../components/TrashPanel'
import { JobForm, useJobConfig } from './Editor'
import { Choice, Day, Field, Text } from '../components/Field'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { bytes } from '../lib/bytes'
import { entryLabel, usePlaces } from '../lib/entryLabel'
import { api } from '../lib/api'
import type { HistoryShow, Job, Run, RunEvent, Touch } from '../lib/api'
import { translateSide, useT } from '../lib/i18n'
import { describeCadence, readCadence } from '../lib/cadence'
import { since } from '../lib/since'

/**
 * The jobs tab: one card per job with its state, actions and live progress,
 * and the form that opens inside a job's own card. The mark on each card says
 * whether the last attempt worked, not merely whether it ran.
 */
export function Jobs({
  jobs,
  runs,
  progress,
  onPreview,
  onSaved,
}: {
  jobs: Job[]
  /**
   * The recent runs, newest first. The live job list only carries the last
   * success, which cannot say whether the last attempt failed.
   */
  runs: Run[]
  progress: Record<string, RunEvent>
  onPreview: (name: string) => void
  onSaved: () => void
}) {
  const { t } = useT()

  // Only the most recent run counts: a job that failed last week and has worked
  // since is not in trouble.
  function lastFailed(name: string): boolean {
    const last = runs.find((r) => r.Job === name)
    return !!last && last.Err !== ''
  }
  const config = useJobConfig(onSaved)
  // The job open in the form, by its position in the configuration file.
  const [editing, setEditing] = useState<number | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  // Whose activity fold is open, by job name; one at a time.
  const [activity, setActivity] = useState<string | null>(null)
  // A counter used as the error's key, so each refused save remounts it and
  // replays the shake.
  const [refused, setRefused] = useState(0)
  // A removed job's state database is deleted by default. Keeping it is for a
  // pair that is coming back, so its files do not all count as new.
  const [dropState, setDropState] = useState(true)

  const raw = config.jobs

  // The live list comes from the engine and the editable one from the
  // configuration file, so a row is matched to its record by name.
  function indexOf(name: string): number | null {
    if (!raw) return null
    const at = raw.findIndex((j) => j.name === name)
    return at === -1 ? null : at
  }

  // Jobs in the configuration that the engine only learns about on save still
  // get a card, marked unsaved.
  const pending = (raw ?? [])
    .map((j, at) => ({ job: j, at }))
    .filter(({ job }) => !jobs.some((live) => live.name === job.name))

  return (
    <Stack>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {config.error && (
          <p key={refused} className="glim-shake me-auto text-xs text-statusFail">
            {config.error}
          </p>
        )}
        {config.saved && !config.error && (
          <p className="me-auto text-xs text-statusOk">{t('edit.savedNote')}</p>
        )}
        {/* The key size, since making a job is what this page is for. It
            stands outside every card, so it needs its own hueIndex. */}
        <IconAction
          title={t('edit.add')}
          labelKey="edit.add"
          size="key"
          hueIndex={0}
          onClick={() => {
            const at = config.add()
            setEditing(at)
          }}
        >
          <IconAdd />
        </IconAction>
      </div>

      {jobs.length === 0 && (!raw || raw.length === 0) ? (
        <Card title={t('jobs.title')} hueIndex={0}>
          <Empty>{t('jobs.empty')}</Empty>
        </Card>
      ) : (
        <>
          {jobs.map((j, i) => {
            const at = indexOf(j.name)
            return (
              <Card
                key={j.name}
                title={j.name}
                hueIndex={i}
              >
                {/* The form replaces the summary inside the job's own card. */}
                {at !== null && at === editing ? (
                  <div className="flex flex-col gap-4">
                    <JobForm
                      job={(raw ?? [])[at]}
                      known={config.known}
                      patch={(next) => config.patch(at, next)}
                    />
                    <div className="flex justify-end gap-2">
                      <IconAction
                        title={t('edit.remove')}
                        labelKey="edit.remove"
                        hueIndex={i + 4}
                        onClick={() => setRemoving(at)}
                      >
                        <IconDelete />
                      </IconAction>
                      <Button
                        label={config.busy ? t('edit.checking') : t('edit.save')}
                        labelKey={config.busy ? 'edit.checking' : 'edit.save'}
                        glyph={<IconSave />}
                        tone="accent"
                        busy={config.busy}
                        disabled={config.busy}
                        onClick={() => {
                          void config.save().then((ok) => {
                            if (ok) setEditing(null)
                            else setRefused((n) => n + 1)
                          })
                        }}
                      />
                    </div>
                  </div>
                ) : (
                <div className="flex flex-col gap-2">
                  {/* The card's sentence (status mark, left side, direction,
                      right side) is centred in the left column, which
                      `items-stretch` makes as tall as the right one holding the
                      cadence and the actions at the top. */}
                  <div className="flex flex-wrap items-stretch gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <JobMark status={statusOf(j, lastFailed(j.name))} size={28} />
                      <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 text-base text-carbon-text">
                        <span className="max-w-[45%] shrink truncate" title={j.left}>
                          {j.left}
                        </span>
                        <DirectionMark direction={j.direction} size={20} />
                        <span className="max-w-[45%] shrink truncate" title={j.right}>
                          {j.right}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                    <Cadence job={j} />
                    {/* Each action takes its own palette position at a fixed
                        offset from the card's index, so a button keeps its
                        colour when a neighbour is not rendered and each card
                        starts its row on a different colour. */}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <IconAction
                        title={t('jobs.activity')}
                        labelKey="jobs.activity"
                        hueIndex={i + 1}
                        onClick={() => setActivity(activity === j.name ? null : j.name)}
                      />
                      {at !== null && (
                        <>
                          <IconAction
                            title={t('edit.editJob')}
                            labelKey="edit.editJob"
                            hueIndex={i + 2}
                            onClick={() => setEditing(at === editing ? null : at)}
                          >
                            <IconEdit />
                          </IconAction>
                          <IconAction
                            title={t('edit.duplicate')}
                            labelKey="edit.duplicate"
                            hueIndex={i + 3}
                            onClick={() => setEditing(config.duplicate(at))}
                          >
                            <IconCopy />
                          </IconAction>
                          <IconAction
                            title={t('edit.remove')}
                            labelKey="edit.remove"
                            hueIndex={i + 4}
                            onClick={() => setRemoving(at)}
                          >
                            <IconDelete />
                          </IconAction>
                        </>
                      )}
                      {/* Holding and starting are separate controls: a held
                          job can still be started by hand, and stays held. */}
                      {at !== null && (
                        <IconAction
                          title={j.disabled ? t('jobs.resume') : t('jobs.pause')}
                          labelKey={j.disabled ? 'jobs.resume' : 'jobs.pause'}
                          hueIndex={i + 5}
                          onClick={() => void config.setDisabled(at, !j.disabled)}
                        >
                          {j.disabled ? <IconRun /> : <IconPause />}
                        </IconAction>
                      )}
                      <IconAction
                        title={j.running ? t('jobs.cancelRun') : t('jobs.runNow')}
                        labelKey={j.running ? 'jobs.cancelRun' : 'jobs.runNow'}
                        hint={j.running ? undefined : t('jobs.runNowHint')}
                        hueIndex={i + 6}
                        onClick={() => void (j.running ? api.stopJob(j.name) : api.run(j.name))}
                      />
                      <IconAction
                        title={t('jobs.preview')}
                        labelKey="jobs.preview"
                        hint={t('jobs.previewHint')}
                        hueIndex={i + 7}
                        onClick={() => onPreview(j.name)}
                      />
                    </div>
                    </div>
                  </div>

                  {activity === j.name && (
                    <JobActivity job={j.name} />
                  )}

                  {at !== null && at === editing && (
                    <>
                      <CheckPanel job={j.name} />
                      <DupesPanel job={j.name} />
                      <TrashPanel job={j.name} />
                    </>
                  )}

                  {j.running && (
                    <>
                      {progress[j.name]?.path && (
                        <p className="flex min-w-0 items-center gap-1.5 text-xs text-carbon-textMuted">
                          {progress[j.name].side && (
                            <span className="shrink-0" aria-hidden>
                              {progress[j.name].side === 'right' ? <IconToRight /> : <IconToLeft />}
                            </span>
                          )}
                          <span className="truncate font-mono" title={progress[j.name].path}>
                            {progress[j.name].path}
                          </span>
                          {progress[j.name].side && (
                            <span className="shrink-0">
                              {translateSide(t, progress[j.name].side as 'left' | 'right')}
                            </span>
                          )}
                        </p>
                      )}
                      <Progress event={progress[j.name]} />
                      <Pace event={progress[j.name]} />
                    </>
                  )}
                </div>
                )}
              </Card>
            )
          })}

          {pending.map(({ job: p, at }) => (
            <Card
              key={`pending-${at}`}
              title={p.name || t('edit.unnamed')}
              hueIndex={jobs.length + at}
            >
              {at === editing ? (
                <div className="flex flex-col gap-4">
                  <JobForm
                    job={p}
                    known={config.known}
                    patch={(next) => config.patch(at, next)}
                  />
                  {/* Delete beside save, so a draft can be dropped unsaved. */}
                  <div className="flex justify-end gap-2">
                    <IconAction
                      title={t('edit.remove')}
                      labelKey="edit.remove"
                      hueIndex={jobs.length + at + 4}
                      onClick={() => setRemoving(at)}
                    >
                      <IconDelete />
                    </IconAction>
                    <Button
                      label={config.busy ? t('edit.checking') : t('edit.save')}
                      labelKey={config.busy ? 'edit.checking' : 'edit.save'}
                      glyph={<IconSave />}
                      tone="accent"
                      busy={config.busy}
                      disabled={config.busy}
                      onClick={() => {
                        void config.save().then((ok) => {
                            if (ok) setEditing(null)
                            else setRefused((n) => n + 1)
                          })
                      }}
                    />
                  </div>
                </div>
              ) : (
              <div className="flex flex-col gap-2">
                {/* The same sentence, at the same size, as a saved card. */}
                <p className="flex min-w-0 flex-wrap items-center gap-2.5 text-base text-carbon-text">
                  <span className="max-w-[45%] shrink truncate">{p.left}</span>
                  <DirectionMark direction={p.direction ?? 'both'} size={20} />
                  <span className="max-w-[45%] shrink truncate">{p.right}</span>
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <Badge tone="neutral">{t('edit.unsaved')}</Badge>
                </div>
                {/* No preview until the engine knows the job. The offsets
                    match the saved card's for the same two actions. */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <IconAction
                    title={t('edit.editJob')}
                    labelKey="edit.editJob"
                    hueIndex={jobs.length + at + 2}
                    onClick={() => setEditing(at === editing ? null : at)}
                  >
                    <IconEdit />
                  </IconAction>
                  <IconAction
                    title={t('edit.remove')}
                    labelKey="edit.remove"
                    hueIndex={jobs.length + at + 4}
                    onClick={() => setRemoving(at)}
                  >
                    <IconDelete />
                  </IconAction>
                </div>
              </div>
              )}
            </Card>
          ))}
        </>
      )}

      {removing !== null && raw && raw[removing] && (
        <ConfirmDialog
          title={t('edit.removeJob')}
          message={t('edit.removeStakes', { name: raw[removing].name || t('edit.unnamed') })}
          confirmLabel={t('confirm.delete')}
          confirmGlyph={<IconDelete />}
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
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            void config.remove(removing, dropState)
            if (editing === removing) setEditing(null)
            setRemoving(null)
          }}
        />
      )}
    </Stack>
  )
}

/**
 * A running job's progress bar, in the accent because it is activity. Until
 * the first step arrives it is indeterminate, since a bar stuck at zero reads
 * as a job failing to start rather than one still listing its sides.
 */
function Progress({ event }: { event?: RunEvent }) {
  const { t } = useT()
  const total = event?.total ?? 0
  const done = event?.done ?? 0
  const known = total > 0

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div
        className="h-1 min-w-0 flex-1 overflow-hidden bg-carbon-surface3"
        style={{ borderRadius: 'var(--radius-pill)' }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={known ? total : undefined}
        aria-valuenow={known ? done : undefined}
      >
        <div
          className={`h-full bg-accent transition-[width] ${known ? '' : 'glim-indeterminate'}`}
          style={{ width: known ? `${Math.min(100, (done / total) * 100)}%` : '35%' }}
        />
      </div>
      <span className="shrink-0 text-xs text-carbon-textMuted">
        {known ? t('progress.of', { done, total }) : t('progress.starting')}
      </span>
    </div>
  )
}

/**
 * A time as "two days ago", with the exact time on hover. The arithmetic lives
 * in lib/since.ts, which the phone shares.
 */
export function Since({ when }: { when: string }) {
  const { t } = useT()
  const { count, unit } = since(when)
  return (
    <span title={new Date(when).toLocaleString()}>
      <Num>{count}</Num> {t(unit)} {t('jobs.ago')}
    </span>
  )
}

/**
 * What the job does, in a sentence, and when it last succeeded; the state
 * itself is the mark. A running job also gets a live badge, since with motion
 * off the mark does not turn.
 */
function Cadence({ job }: { job: Job }) {
  const { t } = useT()
  const words = describeCadence(readCadence(job.schedule ?? '', !!job.watch), t)

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-carbon-textMuted">
      {job.running ? (
        <Badge tone="active" className="glim-live">
          {t('jobs.state.running')}
        </Badge>
      ) : (
        <span className="text-end">
          {job.disabled ? t('jobs.state.disabled') : t('jobs.runs', { cadence: words })}
        </span>
      )}
      {/* The absolute date and time, which "two days ago" cannot replace when
          somebody needs to know whether it was before or after a change. */}
      {job.lastSuccess && (
        <span className="text-end">
          {t('jobs.lastRun', { when: new Date(job.lastSuccess).toLocaleString() })}
        </span>
      )}
    </div>
  )
}

/**
 * What this job has done to individual files, newest first, folded under its
 * card. The runs the page holds carry counts rather than paths, so this has
 * its own endpoint.
 */
function JobActivity({ job }: { job: string }) {
  const { t } = useT()
  const [touches, setTouches] = useState<Touch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Doubles as the list is scrolled to its end, rather than paging.
  const [limit, setLimit] = useState(60)
  // The box answers every keystroke; the server only gets the settled query.
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')

  // Without the pause, each keystroke is a query and out-of-order answers can
  // leave the list showing the results for a prefix.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250)
    return () => clearTimeout(timer)
  }, [typed])

  // A new question starts again at one screenful.
  useEffect(() => setLimit(60), [query])

  useEffect(() => {
    let live = true
    setError(null)
    api
      .jobTouches(job, limit, query)
      .then((got) => live && setTouches(got))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [job, limit, query])

  // The search box stays when nothing matches, so a typo can be corrected.
  const search = (
    <div className="mb-2 flex items-center gap-2">
      <Text
        value={typed}
        onChange={setTyped}
        placeholder={t('jobs.activitySearch')}
        label={t('jobs.activitySearch')}
        mono
      />
      {typed && (
        <IconAction
          title={t('jobs.searchReset')}
          labelKey="jobs.searchReset"
          tone="subtle"
          onClick={() => setTyped('')}
        />
      )}
    </div>
  )

  if (error || !touches || touches.length === 0)
    return (
      <div className="mt-1 w-full">
        {search}
        {error ? (
          <p className="mt-1 text-xs text-statusFail">{error}</p>
        ) : !touches ? (
          <Empty>{t('jobs.activityLoading')}</Empty>
        ) : (
          <Empty>{query ? t('jobs.activityNoMatch', { q: query }) : t('jobs.activityEmpty')}</Empty>
        )}
      </div>
    )

  return (
    <div className="mt-1 w-full">
      {search}
      {/* Loads more near the bottom; 40px rather than the exact end, which a
          trackpad stops a pixel or two short of. */}
      <ul
        className="flex max-h-80 flex-col gap-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollHeight - el.scrollTop - el.clientHeight > 40) return
          // A list shorter than the limit is the whole list.
          if (touches.length >= limit) setLimit((n) => n * 2)
        }}
      >
        {touches.map((e, i) => (
          <TouchRow key={`${e.Run}-${e.Path}-${i}`} touch={e} />
        ))}
      </ul>
    </div>
  )
}

/**
 * One line of the file log, shared by a job's activity fold and the history
 * tab. `withJob` adds the job column, which only makes sense across jobs.
 */
function TouchRow({ touch: e, withJob }: { touch: Touch; withJob?: boolean }) {
  const { t } = useT()
  const { jobs, drives } = usePlaces()
  const label = entryLabel(t, e, jobs.find((j) => j.name === e.Job), drives)
  return (
    <li className="flex items-baseline gap-3 text-xs">
      {/* Wide enough for "Uploaded to" and a target's name; a longer one is
          cut, with the whole phrase in the title. */}
      <span className="w-52 shrink-0 truncate" title={label}>
        <Badge tone={touchTone(e.Kind)}>{label}</Badge>
      </span>
      {/* Wide enough for the longest phrase in any locale, so it never wraps. */}
      <span className="w-28 shrink-0 whitespace-nowrap text-carbon-textMuted">
        <Since when={e.When} />
      </span>
      {withJob && (
        <span className="w-32 shrink-0 truncate font-medium" title={e.Job}>
          {e.Job}
        </span>
      )}
      <span className="w-14 shrink-0 text-end tabular-nums text-carbon-textMuted">
        {e.Size > 0 ? bytes(e.Size) : ''}
      </span>
      {/* The side written to, drawn as an arrow; the word stays in the title
          and the accessible name. */}
      <span
        className="flex w-6 shrink-0 justify-center text-carbon-textMuted"
        title={e.Side ? translateSide(t, e.Side as 'left' | 'right') : undefined}
      >
        {e.Side === 'right' ? <IconToRight /> : e.Side === 'left' ? <IconToLeft /> : null}
        {e.Side && <span className="sr-only">{translateSide(t, e.Side as 'left' | 'right')}</span>}
      </span>
      <span className="min-w-0 flex-1 break-all font-mono text-carbon-text" title={e.Path}>
        {e.Path}
      </span>
      {e.Note && (
        <span className="min-w-0 max-w-[30%] shrink-0 text-carbon-textMuted" title={e.Note}>
          {e.Note}
        </span>
      )}
    </li>
  )
}

/**
 * Every file the engine has touched, across jobs. All three filters apply in
 * the database, since the log runs to tens of thousands of rows and only a
 * screenful has arrived.
 */
function AllTouches({ job, kinds, query }: { job: string; kinds: string[]; query: string }) {
  const { t } = useT()
  const [touches, setTouches] = useState<Touch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(60)

  // A new question starts again at one screenful.
  useEffect(() => setLimit(60), [job, query, kinds.join(',')])

  useEffect(() => {
    let live = true
    setError(null)
    api
      .log(job, kinds, query, limit)
      .then((got) => live && setTouches(got))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [job, kinds.join(','), query, limit])

  if (error) return <p className="mt-1 text-xs text-statusFail">{error}</p>
  if (!touches) return <Empty>{t('history.working')}</Empty>
  if (touches.length === 0)
    return <Empty>{query ? t('jobs.activityNoMatch', { q: query }) : t('history.logEmpty')}</Empty>

  return (
    <ul
      className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        if (el.scrollHeight - el.scrollTop - el.clientHeight > 40) return
        // A list shorter than the limit is the whole list.
        if (touches.length >= limit) setLimit((n) => n * 2)
      }}
    >
      {touches.map((e, i) => (
        <TouchRow key={`${e.Run}-${e.Path}-${i}`} touch={e} withJob={!job} />
      ))}
    </ul>
  )
}

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

type Show = keyof typeof SHOWS

/** Which kinds are a problem, so they stand out in a long list. */
function touchTone(kind: string): 'ok' | 'warn' | 'fail' | 'neutral' {
  if (kind === 'skip' || kind === 'error') return 'fail'
  if (kind === 'conflict') return 'warn'
  return 'neutral'
}

/**
 * The history tab: the file log, or the run log newest first.
 *
 * It fetches its own runs rather than filtering the page's copy, which must
 * stay unfiltered for the job cards. Filters go to the server, since a job
 * watching a folder writes a run a minute and would push a daily job out of
 * any fixed window.
 */
export function History({
  runs,
  jobs,
  onChanged,
}: {
  /** The page's own unfiltered copy, used until this tab's first answer lands. */
  runs: Run[]
  /** The job names to offer, including jobs with no runs yet. */
  jobs: Job[]
  onChanged?: () => void
}) {
  const { t } = useT()
  // Which run is open, by its id; one at a time.
  const [open, setOpen] = useState<number | null>(null)
  const [job, setJob] = useState('')
  const [show, setShow] = useState<HistoryShow>('all')
  // Files first: where a file went is the usual question.
  const [view, setView] = useState<'runs' | 'files'>('files')
  const [kind, setKind] = useState<Show>('all')
  // The box answers every keystroke; the engine only gets the settled query.
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250)
    return () => clearTimeout(timer)
  }, [typed])
  // Two calendar days bounding the runs; blank means open-ended.
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [own, setOwn] = useState<Run[] | null>(null)
  const [loading, setLoading] = useState(false)
  // How many runs to ask for; doubles as the end of the list comes into view.
  const [limit, setLimit] = useState(50)
  const sentinel = useRef<HTMLDivElement | null>(null)

  const filtered = job !== '' || show !== 'all' || since !== '' || until !== ''

  useEffect(() => {
    // The file log has its own query.
    if (view === 'files') return
    let live = true
    setLoading(true)
    api
      .history(job || undefined, show, limit, since, until)
      .then((got) => live && setOwn(got))
      .catch(() => live && setOwn([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [view, job, show, limit, since, until, runs])

  const list = own ?? runs

  // Re-armed whenever the list changes, since the sentinel is then a new
  // element. The dependency on `loading` re-arms it too, so an answer that lands
  // with the sentinel still on screen asks again straight away.
  useEffect(() => {
    const end = sentinel.current
    if (!end) return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading) setLimit((n) => n * 2)
    })
    watcher.observe(end)
    return () => watcher.disconnect()
  }, [list.length, limit, loading])

  // Configuration and log joined: a renamed or deleted job still has runs, and
  // a job that never ran has none.
  const names = useMemo(() => {
    const seen = new Set<string>()
    for (const j of jobs) seen.add(j.name)
    for (const r of runs) seen.add(r.Job)
    for (const r of own ?? []) seen.add(r.Job)
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [jobs, runs, own])

  const controls = (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {/* Both views stay: a run that fails before touching anything writes no
          file lines at all. */}
      <div className="w-40 shrink-0">
        <Choice<'runs' | 'files'>
          label={t('history.filterShow')}
          value={view}
          onChange={setView}
          options={[
            { value: 'files', label: t('history.files') },
            { value: 'runs', label: t('history.runs') },
          ]}
        />
      </div>
      <div className="w-56 shrink-0">
        <Choice
          label={t('history.filterJob')}
          value={job}
          onChange={(next) => {
            setJob(next)
            setLimit(50)
          }}
          options={[
            { value: '', label: t('history.allJobs') },
            ...names.map((n) => ({ value: n, label: n })),
          ]}
        />
      </div>
      {view === 'files' ? (
        <>
          <div className="w-56 shrink-0">
            {/* Its own label, so it is not a second "Show" beside the first. */}
            <Choice<Show>
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
          </div>
          <div className="w-56 shrink-0">
            <Text
              value={typed}
              onChange={setTyped}
              placeholder={t('history.pathHint')}
              label={t('jobs.activitySearch')}
              mono
            />
          </div>
        </>
      ) : null}
      {view === 'runs' ? (
      <>
      <div className="w-56 shrink-0">
        <Choice<HistoryShow>
          label={t('history.filterShow')}
          value={show}
          onChange={(next) => {
            setShow(next)
            setLimit(50)
          }}
          options={[
            { value: 'all', label: t('history.showAll') },
            { value: 'changed', label: t('history.showChanged') },
            { value: 'failed', label: t('history.showFailed') },
          ]}
        />
      </div>
      {/* Two free days rather than presets, since the day in question is
          usually the day it went wrong. */}
      <div className="flex shrink-0 items-end gap-2">
        <Field label={t('history.since')}>
          <Day
            value={since}
            onChange={(next) => {
              setSince(next)
              setLimit(50)
            }}
            label={t('history.since')}
            // A backwards range would look like an empty log.
            max={until || undefined}
          />
        </Field>
        <Field label={t('history.until')}>
          <Day
            value={until}
            onChange={(next) => {
              setUntil(next)
              setLimit(50)
            }}
            label={t('history.until')}
          />
        </Field>
        {(since || until) && (
          // The glyph resolves from the key, which ends in `Reset`.
          <IconAction
            title={t('history.rangeReset')}
            labelKey="history.rangeReset"
            tone="subtle"
            onClick={() => {
              setSince('')
              setUntil('')
              setLimit(50)
            }}
          />
        )}
      </div>
      </>
      ) : null}
      {/* The hint describes the run filters only. */}
      {view === 'runs' ? <InfoBubble tip={t('history.filterHint')} /> : null}
    </div>
  )

  // The file log has its own paging and empty states.
  if (view === 'files') {
    return (
      <Card title={t('history.title')} hueIndex={0}>
        {controls}
        <AllTouches job={job} kinds={SHOWS[kind]} query={query} />
      </Card>
    )
  }

  if (list.length === 0) {
    return (
      <Card title={t('history.title')} hueIndex={0}>
        {controls}
        {/* With a filter on, empty means nothing matches, not no history. */}
        <Empty>{loading ? t('history.working') : filtered ? t('history.noMatch') : t('history.empty')}</Empty>
      </Card>
    )
  }
  return (
    <Card title={t('history.title')} hueIndex={0}>
      {controls}
      <div className="mb-4">
        <Stats />
      </div>
      <ul className="flex flex-col">
        {list.map((r, i) => (
          <li key={`${r.Job}-${r.Started}-${i}`}>
            {i > 0 && <Rule />}
            <button
              type="button"
              aria-expanded={open === r.ID}
              onClick={() => setOpen(open === r.ID ? null : r.ID)}
              className="flex w-full items-center gap-3 py-2.5 text-start text-xs transition-colors hover:bg-carbon-hover"
            >
              <Badge tone={r.Err ? 'fail' : 'ok'}>{r.Err ? t('history.failed') : t('history.ok')}</Badge>
              <span className="w-32 shrink-0 truncate font-medium">{r.Job}</span>
              <span className="shrink-0 text-xs text-carbon-textMuted">
                <Since when={r.Started} />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-carbon-textMuted">
                {r.Err ? (
                  r.Err
                ) : (
                  <>
                    {t('history.copied', { count: r.Copied })}
                    {' · '}
                    {t('history.moved', { count: r.Moved })}
                    {' · '}
                    {t('history.trashed', { count: r.Trashed })}
                    {' · '}
                    {t('history.conflicts', { count: r.Conflicts })}
                    {r.Skipped > 0 && <> {' · '} {t('history.left', { count: r.Skipped })}</>}
                  </>
                )}
              </span>
              {/* Shows which closed run had conflicts without opening each. */}
              {r.Conflicts > 0 && <Badge tone="warn">{r.Conflicts}</Badge>}
            </button>
            {open === r.ID && (
              <RunDetail run={r.ID} job={r.Job} onResolved={() => onChanged?.()} />
            )}
          </li>
        ))}
      </ul>
      {/* Reaching the end loads more. An observed sentinel rather than scroll
          arithmetic, because here the window scrolls, not a box of the list's
          own. Only present when the answer filled the limit. */}
      {list.length >= limit && (
        <div ref={sentinel} className="mt-3 flex justify-center py-2 text-caption text-carbon-textMuted">
          {loading ? t('history.working') : ''}
        </div>
      )}
    </Card>
  )
}
