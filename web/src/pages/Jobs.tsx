import { useEffect, useMemo, useState } from 'react'

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
import { TrashPanel } from '../components/TrashPanel'
import { JobForm, useJobConfig } from './Editor'
import { Choice } from '../components/Field'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { api } from '../lib/api'
import type { HistoryShow, Job, Run, RunEvent, Touch } from '../lib/api'
import { translateSide, useT, type TranslationKey } from '../lib/i18n'
import { describeCadence, readCadence } from '../lib/cadence'

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
   * Whose activity fold is open, by job name. One at a time.
   *
   * It used to live inside the fold's own component, which was fine while the
   * button and the list were one block at the left of the row. They are not any
   * more: the button belongs with the other actions on the right (jdp: "der
   * aktivitaetsbutton auch nach rechts zu den anderen") and the list belongs
   * under the whole row, full width, so the state has to sit above both.
   *
   * One at a time for the same reason the history tab keeps one run open: the
   * question is about ONE job, and several open folds turn a page of cards into
   * a page of tables.
   */
  const [activity, setActivity] = useState<string | null>(null)
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
        {/* One step up, and the only control in this app that takes it. The
            page exists to hold jobs and this is the button that makes one, so
            it is the thing somebody arriving at an empty list has to find.
            GlimStone 1.7.5's second height, which is what "haben wir nicht eine
            groessere standardisierte groesse?" turned out to need: there was no
            such size, and the answer was to give the language one rather than
            to raise every button in the house.

            hueIndex, because it stands outside every card: a Card rebinds
            --accent for its whole subtree, so a row action inside one is
            already painting in that card's colour, and this one has no card to
            inherit from. Position zero, the same the first job card takes. */}
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
                  {/* The card's one sentence: the mark, the left side, the
                      arrow, the right side. The arrow sits between the two
                      because that is where the question is, and both sides hug
                      it rather than stretching to the edges, where a pair of
                      short paths reads as two unrelated facts with a gap in the
                      middle.

                      Set one step up from everything under it, because this row
                      is what the card is ABOUT and it used to be the same 12px
                      as the schedule and the timestamp, so nothing on the card
                      led. jdp: "der PFad der linke seite soll in grosser
                      schrift da stehen, dann das pfeilsymbol, dann der pfad der
                      rechtenseite ebenfalls gross." The arrow grows with the
                      text rather than by a number of its own, because it is
                      punctuation in that sentence.

                      The mark stands at the far left and IS the status display
                      ("ganz links soll das AL Logo in grau stehen und als
                      statusanzeige fungieren"). It is the two-arrow loop the
                      logo is drawn from rather than the logo, for the reason
                      JobMark gives at length: a multi-colour drawing recoloured
                      to a status hue is not a logo any more. Grey is one of the
                      four states it wears and the one a held job gets. */}
                  {/* Two columns, and they are aligned to two different edges
                      on purpose. What the card is ABOUT - the mark and the two
                      paths - sits centred against the whole block, so it reads
                      as the card's one sentence rather than as the first of
                      several rows. Everything you DO to the job, and the line
                      saying when it last did anything, sits at the top of the
                      other column. jdp: "kannst du die pfade und die status
                      anzeige in der card vertikal zentriert ausrichten? und die
                      buttons und der zuletz gelaufen und läuft text weiter nach
                      oben in der card?"

                      `items-stretch` is what makes the centring possible: the
                      left column has to be as tall as the right one before
                      centring inside it means anything. */}
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
                    {/* What it does and when it last did it, at the top right,
                        in words. It used to be a row of three under the paths:
                        a badge saying "abgeschaltet", the word "abgeschaltet"
                        again beside it, and "noch nie gelaufen". jdp: "kann
                        weg: abgeschaltet abgeschaltet noch nie gelaufen."

                        So the state is carried by the mark on the left, which
                        already had it, and this says the two things nothing
                        else on the card could: the cadence in a sentence rather
                        than as a cron expression, and the last run with a real
                        date under it. A job that has never run gets no second
                        line at all, because "never" is exactly what an empty
                        space says. */}
                    <Cadence job={j} />
                    {/* Every button here owns its OWN palette position rather
                        than inheriting the card's.

                        Inheriting was the previous answer and it was reported as
                        the same defect a third time: "Die ganzen buttons auf der
                        auftragscard sind nicht in der farbengine. im
                        regenbogenmodus sollen die unterschiedliche farben haben."
                        A card rebinds --accent for its whole subtree, so seven
                        buttons inside it painted in one colour - which IS the
                        engine, and from a foot away is indistinguishable from
                        seven buttons the engine never reached.

                        The design language allows this: a position belongs to one
                        member of a SET whose members are all equal, and a row of
                        row-actions is exactly that. The offsets are FIXED per
                        action rather than counted along the row, so a button
                        keeps its colour when a neighbour is not rendered - four
                        of these appear only for a job the configuration knows,
                        and a running count would repaint the rest as they came
                        and went.

                        They start one past the card's own index, so each card
                        opens its row on a different colour instead of every card
                        showing the identical seven. */}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {/* The activity fold's button stands WITH the other actions
                          rather than at the far end of the row (jdp: "der
                          aktivitaetsbutton auch nach rechts zu den anderen"). It
                          was pushed left with `me-auto` so the row would read as
                          "look at it" on one side and "act on it" on the other,
                          which is a distinction the row itself never made: looking
                          at a job's runs is one of the things you do to it. Its
                          list opens under the whole row instead, full width. */}
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
                      {/* Start and hold. Two verbs, never one button: a job
                          held on its schedule can still be started by hand, and
                          that is the point of holding it rather than deleting it.
                          Starting is a HUMAN press and goes through the same
                          entry point a scheduled run does not, so a held job
                          stays held afterwards. */}
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
                      {/* The same control as the four above them, which they were
                          not: they were ordinary buttons in the flat `neutral`
                          grey the colour engine cannot reach, so a card whose
                          actions all painted in its own hue would have kept
                          exactly two that did not. And in a mode that hides words
                          an ordinary button still hugs its glyph inside its own
                          horizontal padding, so the row came out as five tiles
                          with two lozenges on the end. Measured in the browser,
                          not guessed: 48 by 32 against 32 by 32. */}
                      <IconAction
                        title={t('jobs.runNow')}
                        labelKey="jobs.runNow"
                        hint={t('jobs.runNowHint')}
                        hueIndex={i + 6}
                        disabled={j.running}
                        onClick={() => void api.run(j.name)}
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

                  {/* Under the row and across the card, which is the width this
                      list needs: a run is a badge, a date, four counts and
                      sometimes an error message. */}
                  {activity === j.name && (
                    <JobActivity job={j.name} />
                  )}

                  {/* Only while the card is open for editing, because this is
                      a question somebody asks deliberately and a panel on every
                      card would be a wall of buttons on a page whose subject is
                      the jobs themselves. */}
                  {at !== null && at === editing && (
                    <>
                      <CheckPanel job={j.name} />
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
                      {/* The bar says how far along; this says how fast and how
                          much longer. A bar alone answers the wrong question:
                          "half done" is useless without "and the other half is
                          four minutes". */}
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
                  <div className="flex justify-end">
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
                {/* The SAME sentence the saved cards draw, at the same size.
                    It was 12px with a 14px arrow while the card above it was
                    16px with a 20px one, so one page showed two different job
                    rows and the unsaved one read as a footnote. A draft is a
                    job that has not been saved, not a smaller kind of job. */}
                <p className="flex min-w-0 flex-wrap items-center gap-2.5 text-base text-carbon-text">
                  <span className="max-w-[45%] shrink truncate">{p.left}</span>
                  <DirectionMark direction={p.direction ?? 'both'} size={20} />
                  <span className="max-w-[45%] shrink truncate">{p.right}</span>
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <Badge tone="neutral">{t('edit.unsaved')}</Badge>
                </div>
                {/* No preview here: there is nothing for the engine to plan
                    against until this has been saved. */}
                {/* Its own positions, and deliberately the SAME offsets the
                    saved card gives these two actions: the pencil is the
                    pencil whether or not the job has been written yet. */}
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

/**
 * What this job does, and when it last did it.
 *
 * It replaces a badge and two words that said the same thing three times: the
 * badge read "abgeschaltet", the field beside it read "abgeschaltet", and the
 * field beside THAT read "noch nie gelaufen" on the same held job. The state is
 * the mark at the other end of the row, which was already carrying it in colour
 * and in its own tip.
 *
 * A running job still gets the one badge that means "right now", and it keeps
 * the pulse the design language's `.glim-live` exists for. That one is not a
 * repeat: the mark says running by turning, and a person who has switched motion
 * off would otherwise have nothing.
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
      {/* The date AND the time, spelled out, rather than only "two days ago".
          jdp: "darunter zuletzt gelaufen mit zeit und datum." The relative form
          answers "is this thing still alive" at a glance and cannot answer "was
          that before or after I changed the folder", so both are here: the
          reading is relative, the fact is absolute, and neither needs a hover. */}
      {job.lastSuccess && (
        <span className="text-end">
          {t('jobs.lastRun', { when: new Date(job.lastSuccess).toLocaleString() })}
        </span>
      )}
    </div>
  )
}

/**
 * This job's own runs, folded away under the card.
 *
 * It draws the same rows the history tab draws and opens the same detail panel,
 * deliberately: two lists of the same thing that look different are two things
 * to learn. What it does NOT do is repeat the history's chart or its whole-app
 * list, because the question here is about one job.
 *
 * Five, and a line saying so. A card is a summary and an unbounded list inside
 * one turns the jobs page into the history tab with extra steps; the History tab
 * is where the rest lives and it is one click away.
 */
/**
 * What this job has done to individual FILES, newest first.
 *
 * It used to list the job's runs, which is the history tab's list in a smaller
 * box: same rows, same counts, one screen away from each other. jdp: "Im
 * aktivitaetslog moechte ich nicht die laeufe sehen sondern ein log ueber die
 * einzelnen dateien, welche kopiert, welche geloescht wurden etc.: Das andere
 * steht ja im Verlauf tab."
 *
 * He is right that they were the same list, and right about which one belongs
 * here. "Which runs happened" is a question about the schedule. "What has this
 * thing done to my files" is the question somebody has while looking at the job
 * itself, and it was the one thing the interface could not answer at all
 * without opening runs one by one.
 *
 * Fetched from its own address rather than assembled from the runs the page
 * already holds: those carry counts, not paths, and a job that ran two hundred
 * times to produce four interesting lines would cost two hundred requests.
 */
function JobActivity({ job }: { job: string }) {
  const { t } = useT()
  const [touches, setTouches] = useState<Touch[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setTouches(null)
    setError(null)
    api
      .jobTouches(job, 60)
      .then((got) => live && setTouches(got))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [job])

  if (error) return <p className="mt-1 text-xs text-statusFail">{error}</p>
  if (!touches) return <Empty>{t('jobs.activityLoading')}</Empty>
  if (touches.length === 0) return <Empty>{t('jobs.activityEmpty')}</Empty>

  return (
    <div className="mt-1 w-full">
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {touches.map((e, i) => (
          <li key={`${e.Run}-${e.Path}-${i}`} className="flex items-start gap-2 text-xs">
            <Badge tone={touchTone(e.Kind)}>{t(TOUCH_LABEL[e.Kind] ?? 'entry.other')}</Badge>
            {/* When, and it is why this is a Touch rather than a plain entry:
                the same file copied twice is two identical lines otherwise. */}
            <span className="w-16 shrink-0 text-carbon-textMuted">
              <Since when={e.When} />
            </span>
            <span className="min-w-0 flex-1 break-all font-mono text-carbon-text" title={e.Path}>
              {e.Path}
            </span>
            {e.Note && (
              <span className="min-w-0 max-w-[35%] shrink-0 text-carbon-textMuted" title={e.Note}>
                {e.Note}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The kinds, in this app's own words. The same table RunDetail uses. */
const TOUCH_LABEL: Record<string, TranslationKey> = {
  copy: 'entry.copy',
  move: 'entry.move',
  trash: 'entry.trash',
  conflict: 'entry.conflict',
  mkdir: 'entry.mkdir',
  rmdir: 'entry.rmdir',
  skip: 'entry.skip',
}

/** Which kinds are a problem, so they stand out in a long list. */
function touchTone(kind: string): 'ok' | 'warn' | 'fail' | 'neutral' {
  if (kind === 'skip' || kind === 'error') return 'fail'
  if (kind === 'conflict') return 'warn'
  return 'neutral'
}

/**
 * The run log, newest first, with the two questions that make it readable.
 *
 * It fetches for ITSELF rather than sharing the page's copy, and that is the
 * load-bearing part. The page fetches the last fifty runs of everything so a
 * job card can say whether its own last attempt failed, and that list must stay
 * unfiltered or the cards start lying. This tab is asking a different question
 * and gets its own answer.
 *
 * Both narrowings go to the server. A job watching a folder writes a run a
 * minute, so fifty runs is fifty minutes and a job that runs once a day is not
 * further down the page, it is not on the page at all. jdp: "im verlauftab,
 * sollte man filtern koennen. zb. echtzeit auftraege ausblenden weil die
 * andauernd laufen und ein eintrag machen. wenn ein auftrag zb nur einemal am
 * tag laeuft geht der unter." Filtering what was already fetched would filter
 * those same fifty and leave the daily job exactly as missing.
 */
export function History({
  runs,
  jobs,
  onChanged,
}: {
  /** The page's own unfiltered copy, used until this tab's first answer lands. */
  runs: Run[]
  /** The names to offer, which the run log itself cannot supply: a job with no
   *  runs yet has nothing in it to be listed by. */
  jobs: Job[]
  onChanged?: () => void
}) {
  const { t } = useT()
  /**
   * Which run is open, by its id. One at a time.
   *
   * Several open at once would turn the page into a wall of paths, and the
   * question somebody arrives with is about ONE run: the one that failed, or
   * the one that touched something they did not expect.
   */
  const [open, setOpen] = useState<number | null>(null)
  const [job, setJob] = useState('')
  const [show, setShow] = useState<HistoryShow>('all')
  const [own, setOwn] = useState<Run[] | null>(null)
  const [loading, setLoading] = useState(false)
  /**
   * How many runs to ask for. Doubles on request rather than paging.
   *
   * A cursor would be the tidier mechanism and the wrong one for this list:
   * somebody looking for a run does not want page four, they want the list to
   * go back further, and doubling reaches a month of a watching job's records
   * in three presses. The filter above is the sharp instrument; this is the
   * blunt one for when you do not know what you are looking for.
   */
  const [limit, setLimit] = useState(50)

  const filtered = job !== '' || show !== 'all'

  useEffect(() => {
    let live = true
    setLoading(true)
    api
      .history(job || undefined, show, limit)
      .then((got) => live && setOwn(got))
      .catch(() => live && setOwn([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [job, show, limit, runs])

  const list = own ?? runs

  // The names come from the configuration AND from the log, joined. A job that
  // has been renamed or deleted still has its runs in here, and leaving it out
  // of the list would make them unreachable; a job that has never run is in the
  // configuration and not in the log, and leaving THAT out means the one job
  // somebody suspects of doing nothing cannot be asked about.
  const names = useMemo(() => {
    const seen = new Set<string>()
    for (const j of jobs) seen.add(j.name)
    for (const r of runs) seen.add(r.Job)
    for (const r of own ?? []) seen.add(r.Job)
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [jobs, runs, own])

  const controls = (
    <div className="mb-4 flex flex-wrap items-end gap-3">
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
      <InfoBubble tip={t('history.filterHint')} />
    </div>
  )

  if (list.length === 0) {
    return (
      <Card title={t('history.title')} hueIndex={0}>
        {controls}
        {/* An empty list means two different things and they must not read the
            same. With no filter on, this log has nothing in it. With one on,
            there is a log and nothing in it matches - and saying "no history"
            there would be a lie about the program rather than about the
            filter. */}
        <Empty>{loading ? t('history.working') : filtered ? t('history.noMatch') : t('history.empty')}</Empty>
      </Card>
    )
  }
  return (
    <Card title={t('history.title')} hueIndex={0}>
      {controls}
      {/* The shape of the last month, above the list of what happened on each
          day. The list answers "what happened on Tuesday"; it cannot answer
          "is this thing doing anything at all", which is the question somebody
          has after leaving a sync tool alone for three weeks. */}
      <div className="mb-4">
        <Stats />
      </div>
      <ul className="flex flex-col">
        {list.map((r, i) => (
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
      {/* Offered only when the answer FILLED the limit, which is the one honest
          signal that there may be more: a shorter list is the whole list. */}
      {list.length >= limit && (
        <div className="mt-3 flex justify-center">
          <Button
            label={loading ? t('history.working') : t('history.more')}
            labelKey={loading ? 'history.working' : 'history.more'}
            disabled={loading}
            onClick={() => setLimit((n) => n * 2)}
          />
        </div>
      )}
    </Card>
  )
}
