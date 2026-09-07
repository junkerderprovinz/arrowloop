import { useState } from 'react'

import { Empty, Num, Rule, Stack } from '../components/Shell'
import { IconAction } from '../components/IconAction'
import { ToggleRow } from '../components/ToggleRow'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { IconAdd, IconCopy, IconDelete, IconEdit, IconPause, IconPreview, IconRun, IconSave, IconToLeft, IconToRight } from '../components/glyphs'
import { DirectionMark } from '../components/Direction'
import { JobMark, statusOf } from '../components/JobMark'
import { RunDetail } from '../components/RunDetail'
import { JobForm, useJobConfig } from './Editor'
import { api } from '../lib/api'
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
  runs,
  progress,
  onPreview,
  onSaved,
}: {
  jobs: Job[]
  /**
   * The recent runs, so a card can say whether the last one ended badly.
   *
   * The live job list carries what a job IS doing and its last SUCCESS, and
   * neither of those answers "did the last attempt fail". A job that failed an
   * hour ago and is now sitting idle looks identical to one that has never had
   * a problem, which is the state somebody most needs to be told about.
   */
  runs: Run[]
  progress: Record<string, RunEvent>
  onPreview: (name: string) => void
  onSaved: () => void
}) {
  const { t } = useT()

  /**
   * Whether this job's MOST RECENT run failed.
   *
   * Most recent, not "any of them failed": a job that failed last week and has
   * worked every day since is not currently in trouble, and a mark that says it
   * is would be one somebody learns to ignore. The list arrives newest first,
   * so the first entry for a name is the one that counts.
   */
  function lastFailed(name: string): boolean {
    const last = runs.find((r) => r.Job === name)
    return !!last && last.Err !== ''
  }
  const config = useJobConfig(onSaved)
  // Which job the form is showing, by its position in the configuration file.
  // Null is a closed form, which is the state this page opens in: somebody
  // arriving here is far more often looking than editing.
  const [editing, setEditing] = useState<number | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  /**
   * A counter, not a boolean, and that is the whole trick.
   *
   * The shake is an animation on a class, so it plays when the class ARRIVES.
   * A boolean already true when a second save is refused adds no class and
   * plays nothing, which is exactly the case that matters: the second time you
   * press save the validator still refuses. A number that goes up every
   * refusal makes the key change, React replaces the element, and the
   * animation starts over. GlimStone's tokens.css says the same thing above
   * its own keyframe.
   */
  const [refused, setRefused] = useState(0)
  // Deleting the state database along with the job is the DEFAULT, because a
  // job somebody is removing on purpose leaves a database nothing will ever
  // open again. Keeping it is the deliberate answer, for the case the same
  // pair is coming back and every file should not count as new.
  const [dropState, setDropState] = useState(true)

  const raw = config.jobs

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
      {/* The page's own action, above the cards rather than inside one.
          A card exists to group a subject, and "add a job" is not a subject; a
          card holding a button and nothing else is a box drawn around a
          toolbar. Same arrangement BombVault's own list pages use.

          Right-aligned, and there is only one of it now. The save button that
          used to sit here is gone: it acted on the whole page, so a job edited
          in a card at the bottom was saved by a control at the top, and the
          most common thing anybody does here, deleting a job, did not reach the
          file at all until that button was found and pressed. Saving belongs on
          the thing being saved, and removing saves itself. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {config.error && (
          <p key={refused} className="glim-shake me-auto text-xs text-statusFail">
            {config.error}
          </p>
        )}
        {config.saved && !config.error && (
          <p className="me-auto text-xs text-statusOk">{t('edit.savedNote')}</p>
        )}
        <IconAction
          title={t('edit.add')}
          onClick={() => {
            const at = config.add()
            setEditing(at)
          }}
        >
          <IconAdd />
        </IconAction>
      </div>

      {/* ONE CARD PER JOB (jdp: "jeder auftrag soll eine eigene card sein").
          It was one card holding a list of rules-separated rows, and the rows
          were the problem: a job is a subject in its own right, with a name, a
          state, two sides and its own actions, and a hairline between two of
          them says less than a surface around each. Each card also takes its
          own position in the palette, so a page of jobs reads as a set rather
          than as one long striped block.

          The live progress moved in here with them. It had a card of its own at
          the top of the page ("Gerade jetzt"), which meant a running job was
          described in two places at once and the top one repeated a name the
          list below was already showing. Progress belongs on the job that is
          making it. */}
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
                {/* ONE card, not two. Opening a job used to leave its summary
                    card standing and add a second card underneath with the
                    form in it, so "auftrag anlegen" produced two boxes for one
                    job and the name appeared twice. The form REPLACES the
                    summary inside the job's own card: same card, same colour,
                    same place on the page. */}
                {at !== null && at === editing ? (
                  <div className="flex flex-col gap-4">
                    <JobForm
                      job={(raw ?? [])[at]}
                      known={config.known}
                      patch={(next) => config.patch(at, next)}
                    />
                    <div className="flex justify-end">
                      <Button
                        label={config.busy ? t('edit.checking') : t('edit.save')}
                        labelKey={null}
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
                  {/* The arrow sits between the two sides because that is where
                      the question is: which way does this go. Both sides hug
                      the arrow rather than stretching to the edges, where a
                      pair of short paths reads as two unrelated facts with a
                      gap in the middle. */}
                  {/* The two sides and the arrow between them, one step up in
                      size from the facts below. This row is what the card is
                      ABOUT and it was set in the same 12px as the schedule and
                      the timestamp under it, so nothing on the card led. jdp:
                      "der text der ordner und das pfeil symbol soll groesser
                      sein." The arrow grows with the text rather than by its
                      own number, because it is punctuation in that sentence. */}
                  <div className="flex items-center gap-2.5">
                    <JobMark status={statusOf(j, lastFailed(j.name))} />
                    <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm text-carbon-text">
                      <span className="max-w-[45%] shrink truncate" title={j.left}>
                        {j.left}
                      </span>
                      <DirectionMark direction={j.direction} size={16} />
                      <span className="max-w-[45%] shrink truncate" title={j.right}>
                        {j.right}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-carbon-textMuted">
                    <State job={j} />
                    <span>
                      {j.disabled
                        ? t('jobs.state.disabled')
                        : j.schedule || t('jobs.schedule.onRequest')}
                    </span>
                    <span>
                      {j.lastSuccess ? <Since when={j.lastSuccess} /> : t('jobs.neverWorked')}
                    </span>
                  </div>

                  {/* The live detail moved here from the card that used to sit
                      at the top of the page. It is the same two facts it always
                      carried, and they belong on the job making them: the path
                      is what changes second by second and is the whole reason
                      to watch, and the side is what says which way, which is
                      the question a two-way sync raises every time it acts. */}
                  {/* The card's own controls, at the foot of its body. The
                      card has no action slot of its own: GlimStone's Card
                      draws a heading and nothing else, and a row of buttons
                      inside the body is where BombVault keeps a card's
                      controls too. The delete badge is NOT red, because the
                      language is explicit that a destructive TRIGGER takes the
                      same treatment as the badges beside it and carries its
                      meaning in its glyph, its tip and the window it opens. */}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {at !== null && (
                      <>
                        <IconAction
                          title={t('edit.editJob')}
                          onClick={() => setEditing(at === editing ? null : at)}
                        >
                          <IconEdit />
                        </IconAction>
                        <IconAction
                          title={t('edit.duplicate')}
                          onClick={() => setEditing(config.duplicate(at))}
                        >
                          <IconCopy />
                        </IconAction>
                        <IconAction title={t('edit.remove')} onClick={() => setRemoving(at)}>
                          <IconDelete />
                        </IconAction>
                      </>
                    )}
                    {/* Start and hold. Two verbs, never one button: a job
                        held on its schedule can still be started by hand, and
                        that is the point of holding it rather than deleting it.
                        Starting is a HUMAN press and goes through the same
                        entry point a scheduled run does not, so a held job
                        stays held afterwards. */}
                    {at !== null && (
                      <IconAction
                        title={j.disabled ? t('jobs.resume') : t('jobs.pause')}
                        onClick={() => void config.setDisabled(at, !j.disabled)}
                      >
                        {j.disabled ? <IconRun /> : <IconPause />}
                      </IconAction>
                    )}
                    <Button
                      label={t('jobs.runNow')}
                      labelKey={null}
                      glyph={<IconRun />}
                      title={t('jobs.runNowHint')}
                      disabled={j.running}
                      onClick={() => void api.run(j.name)}
                    />
                    <Button
                      label={t('jobs.preview')}
                      labelKey={null}
                      glyph={<IconPreview />}
                      onClick={() => onPreview(j.name)}
                    />
                  </div>

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
                  <div className="flex justify-end">
                    <Button
                      label={config.busy ? t('edit.checking') : t('edit.save')}
                      labelKey={null}
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
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-carbon-textMuted">
                  <span className="max-w-[45%] shrink truncate">{p.left}</span>
                  <DirectionMark direction={p.direction ?? 'both'} />
                  <span className="max-w-[45%] shrink truncate">{p.right}</span>
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <Badge tone="neutral">{t('edit.unsaved')}</Badge>
                </div>
                {/* No preview here: there is nothing for the engine to plan
                    against until this has been saved. */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <IconAction
                    title={t('edit.editJob')}
                    onClick={() => setEditing(at === editing ? null : at)}
                  >
                    <IconEdit />
                  </IconAction>
                  <IconAction title={t('edit.remove')} onClick={() => setRemoving(at)}>
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
      <span className="shrink-0 text-xs text-carbon-textMuted">
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
  // The one badge that means "right now" carries the pulse, which is what the
  // design language's own .glim-live class is for. Every other state here is a
  // fact that will still be true in a minute and holds still.
  if (job.running) {
    return (
      <Badge tone="active" className="glim-live">
        {t('jobs.state.running')}
      </Badge>
    )
  }
  if (job.disabled) return <Badge tone="neutral">{t('jobs.state.disabled')}</Badge>
  if (!job.lastSuccess) return <Badge tone="neutral">{t('jobs.state.waiting')}</Badge>
  return <Badge tone="ok">{t('jobs.state.settled')}</Badge>
}

/** The run log, newest first. */
export function History({ runs, onChanged }: { runs: Run[]; onChanged?: () => void }) {
  const { t } = useT()
  /**
   * Which run is open, by its id. One at a time.
   *
   * Several open at once would turn the page into a wall of paths, and the
   * question somebody arrives with is about ONE run: the one that failed, or
   * the one that touched something they did not expect.
   */
  const [open, setOpen] = useState<number | null>(null)
  if (runs.length === 0) {
    return (
      <Card title={t('history.title')} hueIndex={0}>
        <Empty>{t('history.empty')}</Empty>
      </Card>
    )
  }
  return (
    <Card title={t('history.title')} hueIndex={0}>
      <ul className="flex flex-col">
        {runs.map((r, i) => (
          <li key={`${r.Job}-${r.Started}-${i}`}>
            {i > 0 && <Rule />}
            {/* The whole row opens it, not a chevron at one end. The row is
                already the thing being asked about, and a target the width of
                the card is a target nobody has to aim at. */}
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
              {/* A count of the things somebody would want to look at, on the
                  closed row. Without it, opening every run one by one is the
                  only way to find the one that had a conflict. */}
              {r.Conflicts > 0 && <Badge tone="warn">{r.Conflicts}</Badge>}
            </button>
            {open === r.ID && (
              <RunDetail run={r.ID} job={r.Job} onResolved={() => onChanged?.()} />
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
