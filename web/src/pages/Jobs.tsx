import { useState } from 'react'

import { Badge, Button, Card, Confirm, Empty, IconButton, Num, Rule, Stack } from '../components/Shell'
import { IconAdd, IconDelete, IconEdit, IconPreview, IconToLeft, IconToRight } from '../components/glyphs'
import { DirectionMark } from '../components/Direction'
import { JobForm, useJobConfig } from './Editor'
import type { Job, Run, RunEvent } from '../lib/api'
import { translateSide, useT, type TranslationKey } from '../lib/i18n'

/**
 * The jobs tab: what exists, what is happening, and the form to change it.
 *
 * The list and the editor used to be two tabs, which meant the plus button and
 * the list it added to were never on screen together and every edit began by
 * finding the same job twice. They are one page now: the plus adds a job and
 * opens it, the pencil on a row opens that row, and the form appears under the
 * list rather than on a tab somebody has to go and find.
 *
 * The list itself answers the question a person actually has, which is not
 * "when did this last run" but "when did this last WORK". A job failing every
 * quarter of an hour looks busy in a log while being of no use at all.
 */
export function Jobs({
  jobs,
  progress,
  onPreview,
  onSaved,
}: {
  jobs: Job[]
  progress: Record<string, RunEvent>
  onPreview: (name: string) => void
  onSaved: () => void
}) {
  const { t } = useT()
  const config = useJobConfig(onSaved)
  // Which job the form is showing, by its position in the configuration file.
  // Null is a closed form, which is the state this page opens in: somebody
  // arriving here is far more often looking than editing.
  const [editing, setEditing] = useState<number | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)

  const raw = config.jobs
  const job = editing !== null && raw ? raw[editing] : undefined

  // The live list comes from the engine and the editable one from the
  // configuration file, so a row is matched to its record by name.
  function indexOf(name: string): number | null {
    if (!raw) return null
    const at = raw.findIndex((j) => j.name === name)
    return at === -1 ? null : at
  }

  // A job added a moment ago is in the configuration and not yet in the engine,
  // because the engine only learns about it on save. It still gets a row: a
  // plus button whose result appears nowhere reads as a button that did
  // nothing, and the fix for that is not a message but the row itself. The row
  // says it is unsaved rather than pretending to be a real one.
  const pending = (raw ?? [])
    .map((j, at) => ({ job: j, at }))
    .filter(({ job }) => !jobs.some((live) => live.name === job.name))

  return (
    <Stack>
      <Live jobs={jobs} progress={progress} />

      <Card
        title={t('jobs.title')}
        hue={0}
        actions={
          <>
            {/* The plus sits on the list it adds to. A creation button on a
                different tab is a button somebody has to remember exists. */}
            <IconButton
              title={t('edit.add')}
              onClick={() => {
                const at = config.add()
                setEditing(at)
              }}
            >
              <IconAdd />
            </IconButton>
            {config.jobs && (
              <Button primary onClick={() => void config.save()} disabled={config.busy}>
                {config.busy ? t('edit.checking') : t('edit.save')}
              </Button>
            )}
          </>
        }
      >
        {config.error && <p className="mb-3 text-[12px] text-statusFail">{config.error}</p>}
        {config.saved && !config.error && (
          <p className="mb-3 text-[12px] text-statusOk">{t('edit.savedNote')}</p>
        )}

        {jobs.length === 0 && (!raw || raw.length === 0) ? (
          <Empty>{t('jobs.empty')}</Empty>
        ) : (
          <ul className="flex flex-col">
            {jobs.map((j, i) => {
              const at = indexOf(j.name)
              return (
                <li key={j.name}>
                  {i > 0 && <Rule />}
                  <div className="group flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium">{j.name}</span>
                        <State job={j} />
                      </div>
                      {/* The arrow sits between the two sides because that is
                          where the question is: which way does this go.
                          Both sides hug the arrow rather than stretching to
                          fill the row: a pair of short paths pushed to opposite
                          ends reads as two unrelated facts with a gap in the
                          middle, which is the opposite of what the arrow is
                          there to say. */}
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-carbon-textMuted">
                        <span className="max-w-[45%] shrink truncate" title={j.left}>
                          {j.left}
                        </span>
                        <DirectionMark direction={j.direction} />
                        <span className="max-w-[45%] shrink truncate" title={j.right}>
                          {j.right}
                        </span>
                      </p>
                      {j.running && <Progress event={progress[j.name]} />}
                    </div>

                    {/* Fixed columns, so the same fact sits at the same x on
                        every row. Ragged columns turn a list into a pile. */}
                    <span className="hidden w-36 shrink-0 truncate text-right text-[11px] text-carbon-textMuted md:inline">
                      {j.disabled
                        ? t('jobs.state.disabled')
                        : j.schedule || t('jobs.schedule.onRequest')}
                    </span>

                    <span className="w-32 shrink-0 text-right text-[11px] text-carbon-textMuted">
                      {j.lastSuccess ? <Since when={j.lastSuccess} /> : t('jobs.neverWorked')}
                    </span>

                    {/* Secondary actions appear on hover, so a list of twenty
                        jobs is twenty names rather than sixty buttons. */}
                    {at !== null && (
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <IconButton
                          title={t('edit.editJob')}
                          onClick={() => setEditing(at === editing ? null : at)}
                        >
                          <IconEdit />
                        </IconButton>
                        <IconButton tone="fail" title={t('edit.remove')} onClick={() => setRemoving(at)}>
                          <IconDelete />
                        </IconButton>
                      </div>
                    )}

                    {/* The primary action for a row stays visible; it is the one
                        thing somebody came to this row to do. */}
                    <Button onClick={() => onPreview(j.name)}>
                      <span className="glim-btn-glyph" aria-hidden>
                        <IconPreview />
                      </span>
                      <span className="glim-btn-label">{t('jobs.preview')}</span>
                    </Button>
                  </div>
                </li>
              )
            })}

            {pending.map(({ job: p, at }) => (
              <li key={`pending-${at}`}>
                {(jobs.length > 0 || at > 0) && <Rule />}
                <div className="group flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium">
                        {p.name || t('edit.unnamed')}
                      </span>
                      <Badge tone="neutral">{t('edit.unsaved')}</Badge>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-carbon-textMuted">
                      <span className="max-w-[45%] shrink truncate">{p.left}</span>
                      <DirectionMark direction={p.direction ?? 'both'} />
                      <span className="max-w-[45%] shrink truncate">{p.right}</span>
                    </p>
                  </div>
                  {/* No preview button: there is nothing for the engine to plan
                      against until this has been saved. */}
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      title={t('edit.editJob')}
                      onClick={() => setEditing(at === editing ? null : at)}
                    >
                      <IconEdit />
                    </IconButton>
                    <IconButton tone="fail" title={t('edit.remove')} onClick={() => setRemoving(at)}>
                      <IconDelete />
                    </IconButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {job && editing !== null && (
        <Card
          title={job.name || t('edit.unnamed')}
          hue={1}
          actions={<Button onClick={() => setEditing(null)}>{t('edit.close')}</Button>}
        >
          <JobForm
            job={job}
            known={config.known}
            patch={(next) => config.patch(editing, next)}
          />
        </Card>
      )}

      {removing !== null && raw && raw[removing] && (
        <Confirm
          title={t('edit.removeJob')}
          stakes={t('edit.removeStakes', { name: raw[removing].name || t('edit.unnamed') })}
          confirmLabel={t('confirm.delete')}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            config.remove(removing)
            if (editing === removing) setEditing(null)
            setRemoving(null)
          }}
        />
      )}
    </Stack>
  )
}

/**
 * What the engine is doing right now.
 *
 * The card is here rather than tucked into a running row because "is anything
 * happening" is a question about the whole program, and answering it inside one
 * row means finding that row first. When nothing is running it says so in one
 * line rather than disappearing: a panel that vanishes when idle leaves somebody
 * wondering whether it is idle or broken.
 */
function Live({ jobs, progress }: { jobs: Job[]; progress: Record<string, RunEvent> }) {
  const { t } = useT()
  const running = jobs.filter((j) => j.running)

  return (
    <Card title={t('live.title')} hue={6} hint={t('live.hint')}>
      {running.length === 0 ? (
        <p className="text-[12px] text-carbon-textMuted">{t('live.idle')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {running.map((j) => {
            const event = progress[j.name]
            return (
              <li key={j.name} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{t('jobs.state.running')}</Badge>
                  <span className="truncate text-[13px] font-medium">{j.name}</span>
                </div>
                {/* The file and the side it lands on. The path is what changes
                    second by second and is the whole reason to watch, but on
                    its own it only says something is moving; the side is what
                    says which way, which is the question a two-way sync raises
                    every time it does anything. */}
                {event?.path && (
                  <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-carbon-textMuted">
                    {event.side && (
                      <span className="shrink-0" aria-hidden>
                        {event.side === 'right' ? <IconToRight /> : <IconToLeft />}
                      </span>
                    )}
                    <span className="truncate font-mono" title={event.path}>
                      {event.path}
                    </span>
                    {event.side && (
                      <span className="shrink-0">{translateSide(t, event.side)}</span>
                    )}
                  </p>
                )}
                <Progress event={event} />
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}


/**
 * What a running job is doing right now.
 *
 * The bar is the one place on this page where the accent is correct, because
 * this is the only thing on it that is actually happening. Before the first
 * step arrives the bar is deliberately indeterminate rather than sitting at
 * zero: a bar stuck at zero reads as a job that is failing to start, when it is
 * a job that is still listing two sides.
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
      <span className="shrink-0 text-[11px] text-carbon-textMuted">
        {known ? t('progress.of', { done, total }) : t('progress.starting')}
      </span>
    </div>
  )
}

const unitKey: [number, TranslationKey][] = [
  [60, 'time.second'],
  [60, 'time.minute'],
  [24, 'time.hour'],
  [365, 'time.day'],
]

/**
 * A stamp on its own is a number somebody has to subtract from today. "Two days
 * ago" is the thing they were going to work out anyway, and the exact time
 * stays available on hover for when it matters.
 *
 * The sentence is built with the number first and the unit after it, and the
 * unit is a plain plural in every language. Splitting it into one-and-other
 * forms looks more correct and is less so: languages whose rules select "few"
 * or "many" would fall through to English at the commonest counts.
 */
export function Since({ when }: { when: string }) {
  const { t } = useT()
  const then = new Date(when)
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000)
  let value = seconds
  let unit: TranslationKey = 'time.second'
  for (const [size, name] of unitKey) {
    if (value < size) {
      unit = name
      break
    }
    value /= size
    unit = name
  }
  return (
    <span title={then.toLocaleString()}>
      <Num>{Math.floor(value)}</Num> {t(unit)} {t('jobs.ago')}
    </span>
  )
}

function State({ job }: { job: Job }) {
  const { t } = useT()
  if (job.running) return <Badge tone="accent">{t('jobs.state.running')}</Badge>
  if (job.disabled) return <Badge tone="neutral">{t('jobs.state.disabled')}</Badge>
  if (!job.lastSuccess) return <Badge tone="neutral">{t('jobs.state.waiting')}</Badge>
  return <Badge tone="ok">{t('jobs.state.settled')}</Badge>
}

/** The run log, newest first. */
export function History({ runs }: { runs: Run[] }) {
  const { t } = useT()
  if (runs.length === 0) {
    return (
      <Card title={t('history.title')} hue={0}>
        <Empty>{t('history.empty')}</Empty>
      </Card>
    )
  }
  return (
    <Card title={t('history.title')} hue={0}>
      <ul className="flex flex-col">
        {runs.map((r, i) => (
          <li key={`${r.Job}-${r.Started}-${i}`}>
            {i > 0 && <Rule />}
            <div className="flex items-center gap-3 py-2.5 text-[12px]">
              <Badge tone={r.Err ? 'fail' : 'ok'}>{r.Err ? t('history.failed') : t('history.ok')}</Badge>
              <span className="w-32 shrink-0 truncate font-medium">{r.Job}</span>
              <span className="shrink-0 text-[11px] text-carbon-textMuted">
                <Since when={r.Started} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-carbon-textMuted">
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
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
