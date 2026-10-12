// The Anomalies page: the findings as one list with tiles above it that pick a
// severity, and each finding's details and answers in a window. Jobs without
// findings keep their brakes in a card below. The layout is BombVault's, so a
// finding reads the same in both apps.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import { Dialog } from '../components/Dialog'
import { Field, NumberField } from '../components/Field'
import { IconAnomalies } from '../components/glyphs'
import { FilterButton, FilterChoice, ListBar } from '../components/ListBar'
import { HUE_OFFSET, Selector } from '../components/Selector'
import { Empty, Rows, Stack } from '../components/Shell'
import { Since } from '../components/Since'
import { ToggleRow } from '../components/ToggleRow'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import {
  SEVERITIES,
  countBySeverity,
  figures,
  globalBrakes,
  leadingAnswer,
  ownBrakes,
  sentence,
  shortLine,
  type Brakes,
  type Finding,
  type FindingListing,
  type Severity,
} from '../lib/anomalies'
import { api, type Job, type RawJob } from '../lib/api'
import { hueVars } from '../lib/appearance'
import { useT, type TranslationKey } from '../lib/i18n'
import { useOpenJob } from '../lib/openJob'
import { useToast } from '../lib/toast'

const TILE_LABEL: Record<Severity, TranslationKey> = {
  critical: 'anomaly.severity.critical',
  warning: 'anomaly.tile.warning',
  info: 'anomaly.tile.info',
}

const DOT: Record<Severity, string> = {
  critical: 'bg-statusFailSolid',
  warning: 'bg-statusWarnSolid',
  info: 'bg-carbon-textMuted',
}

const BADGE_TONE: Record<Severity, 'fail' | 'warn' | 'neutral'> = {
  critical: 'fail',
  warning: 'warn',
  info: 'neutral',
}

/** How long a typed brake value waits before it is saved, as on the settings page. */
const SETTLE_MS = 700

type Tile = 'all' | Severity

/**
 * Each job's own brakes, read from the configuration and written back to it. A
 * typed value waits to settle, since every save makes the engine reload.
 */
function useBrakes() {
  const push = useToast()
  const [jobs, setJobs] = useState<RawJob[] | null>(null)
  const [global, setGlobal] = useState<Brakes>(() => globalBrakes(undefined))
  const latest = useRef<RawJob[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api
      .config()
      .then((got) => setJobs(got.jobs))
      .catch((e: Error) => push(e.message, 'fail'))
    api
      .settings()
      .then((got) => setGlobal(globalBrakes(got.defaults)))
      .catch(() => {})
  }, [push])

  const commit = useCallback(() => {
    timer.current = null
    if (!latest.current) return
    api.saveConfig(latest.current).catch((e: Error) => push(e.message, 'fail'))
  }, [push])

  // Leaving the page sends a value still waiting to settle.
  useEffect(
    () => () => {
      if (!timer.current) return
      clearTimeout(timer.current)
      commit()
    },
    [commit],
  )

  const setOwn = useCallback(
    (name: string, own: Pick<Brakes, 'brakePercent' | 'changePercent'> | null, settle: boolean) => {
      setJobs((prev) => {
        if (!prev) return prev
        const next = prev.map((j) => {
          if (j.name !== name) return j
          const { brakePercent: _b, changePercent: _c, ...rest } = j
          return own ? { ...rest, ...own } : rest
        })
        latest.current = next
        return next
      })
      if (timer.current) clearTimeout(timer.current)
      if (settle) timer.current = setTimeout(commit, SETTLE_MS)
      else commit()
    },
    [commit],
  )

  return { jobs, global, setOwn }
}

type BrakeBook = ReturnType<typeof useBrakes>

export function Anomalies({
  listing,
  jobs,
  job: focus,
  finding: focusFinding,
  refused,
  onChanged,
}: {
  /** Null until the first answer arrives. */
  listing: FindingListing | null
  jobs: Job[]
  /** The job to narrow the list to, when another screen sent somebody here for it. */
  job: string
  /** The finding whose window opens, when another screen sent somebody here for it. */
  finding?: string
  /** How often a brake has refused each job since the page loaded. */
  refused: Record<string, number>
  onChanged: () => void
}) {
  const { t } = useT()
  const push = useToast()
  const brakes = useBrakes()
  const [tile, setTile] = useState<Tile>('all')
  const [closedView, setClosedView] = useState(false)
  const [job, setJob] = useState(focus)
  const [opened, setOpened] = useState<string | null>(focusFinding ?? null)
  const [watching, setWatching] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ finding: Finding; answer: 'run' | 'back' } | null>(null)
  // The jobs whose refused change was let run, with the refusals counted then.
  const allowed = useRef(new Map<string, number>())

  useEffect(() => setOpened(focusFinding ?? null), [focusFinding])
  useEffect(() => setJob(focus), [focus])

  // The permission covers what was shown. A job the brake refuses again after
  // it was given has changed since, and says so.
  useEffect(() => {
    for (const [name, before] of allowed.current) {
      if ((refused[name] ?? 0) <= before) continue
      allowed.current.delete(name)
      push(t('anomaly.heldAgain', { job: name }), 'fail')
    }
  }, [refused, push, t])

  const open = listing?.open ?? []
  const closed = listing?.closed ?? []
  const pool = (closedView ? closed : open).filter((f) => !job || f.job === job)
  const rank = (s: Severity) => SEVERITIES.indexOf(s)
  const shown = pool
    .filter((f) => tile === 'all' || f.severity === tile)
    .sort((a, b) => (closedView ? 0 : rank(a.severity) - rank(b.severity)) || a.job.localeCompare(b.job))
  const loud = new Set(open.map((f) => f.job))
  const quiet = jobs.filter((j) => !loud.has(j.name))
  const names = [...new Set([...jobs.map((j) => j.name), ...open.map((f) => f.job)])].sort((a, b) => a.localeCompare(b))
  const current = opened ? [...open, ...closed].find((f) => f.id === opened) : undefined
  const places: [string, string] = [t('side.left'), t('side.right')]

  function answer(finding: Finding, how: 'run' | 'back') {
    if (how === 'run') allowed.current.set(finding.job, refused[finding.job] ?? 0)
    api
      .answerAnomaly(finding.id, how)
      .then(() => push(t('anomaly.started', { job: finding.job })))
      .catch((e: Error) => push(e.message, 'fail'))
      .finally(onChanged)
  }

  function acknowledge(finding: Finding) {
    api
      .acknowledgeAnomaly(finding.id)
      .then(() => push(t('anomaly.acknowledged')))
      .catch((e: Error) => push(e.message, 'fail'))
      .finally(onChanged)
  }

  function runNow(finding: Finding) {
    api
      .run(finding.job)
      .then(() => push(t('anomaly.started', { job: finding.job })))
      .catch((e: Error) => push(e.message, 'fail'))
  }

  return (
    <Stack>
      <SeverityTiles counts={countBySeverity(open.filter((f) => !job || f.job === job))} chosen={tile} onChoose={setTile} />

      <div className="flex flex-col gap-6">
        <ListBar
          start={
            <div className="w-full sm:w-auto sm:min-w-64">
              <Selector<'open' | 'closed'>
                scale="small"
                label={t('anomalies.which')}
                hueOffset={HUE_OFFSET.tabs}
                value={closedView ? 'closed' : 'open'}
                onChange={(next) => setClosedView(next === 'closed')}
                options={[
                  { value: 'open', label: t('anomalies.openTab') },
                  { value: 'closed', label: t('anomaly.closed') },
                ]}
              />
            </div>
          }
        >
          <FilterButton active={job !== ''}>
            <FilterChoice
              label={t('history.filterJob')}
              value={job}
              onChange={setJob}
              options={[{ value: '', label: t('history.allJobs') }, ...names.map((n) => ({ value: n, label: n }))]}
            />
          </FilterButton>
        </ListBar>

        <Card title={tile === 'all' ? t('anomalies.all') : t(TILE_LABEL[tile])} hueIndex={0}>
          {listing === null ? (
            <Empty>{t('history.working')}</Empty>
          ) : shown.length === 0 ? (
            <Empty>{closedView ? t('anomaly.noneClosed') : pool.length === 0 ? t('anomaly.none') : t('anomaly.noneShown')}</Empty>
          ) : (
            <Rows className="-mx-2 flex flex-col">
              {shown.map((f) => (
                <FindingRow key={f.id} finding={f} places={places} closed={closedView} onOpen={() => setOpened(f.id)} />
              ))}
            </Rows>
          )}
        </Card>
      </div>

      {listing !== null && quiet.length > 0 && (
        <Card title={t('anomaly.quiet')} hint={t('anomaly.quietHint')} hueIndex={1}>
          <Rows className="-mx-2 grid gap-x-8 md:grid-cols-2">
            {quiet.map((j) => (
              <li
                key={j.name}
                onClick={() => setWatching(j.name)}
                className="glim-row flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-2 hover:bg-carbon-hover"
              >
                <button type="button" className="min-w-0 flex-1 truncate text-start text-body text-carbon-text">
                  {j.name}
                </button>
                {ownBrakes(
                  brakes.jobs?.find((raw) => raw.name === j.name),
                  brakes.global,
                ) && <Badge tone="neutral">{t('anomalies.ownBadge')}</Badge>}
              </li>
            ))}
          </Rows>
        </Card>
      )}

      {current && (
        <FindingWindow
          finding={current}
          places={places}
          onClose={() => setOpened(null)}
          onWatch={() => setWatching(current.job)}
          onAsk={(how) => setAsking({ finding: current, answer: how })}
          onAcknowledge={() => {
            acknowledge(current)
            setOpened(null)
          }}
          onRun={() => {
            runNow(current)
            setOpened(null)
          }}
        />
      )}

      {watching && (
        <Dialog title={`${t('anomaly.monitoring')}: ${watching}`} onClose={() => setWatching(null)}>
          <Monitoring job={watching} brakes={brakes} />
        </Dialog>
      )}

      {asking && (
        <ConfirmDialog
          title={t(asking.answer === 'run' ? 'anomaly.runAsk' : 'anomaly.restoreAsk', { job: asking.finding.job })}
          message={
            asking.answer === 'run'
              ? sentence(asking.finding, t, places) + ' ' + t('anomaly.runHint')
              : asking.finding.kind === 'empty'
                ? t('anomaly.restoreEmpty', { place: places[asking.finding.side === 'right' ? 1 : 0] }) +
                  ' ' +
                  t('anomaly.restoreHint')
                : t('anomaly.restoreHint')
          }
          confirmLabel={t(asking.answer === 'run' ? 'anomaly.run' : 'anomaly.restore')}
          confirmLabelKey={asking.answer === 'run' ? 'anomaly.run' : 'anomaly.restore'}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            answer(asking.finding, asking.answer)
            setAsking(null)
            setOpened(null)
          }}
        />
      )}
    </Stack>
  )
}

/**
 * The tiles count the open findings by severity and pick what the list shows:
 * everything, or one severity. The rest of the page stays.
 */
function SeverityTiles({
  counts,
  chosen,
  onChoose,
}: {
  counts: Record<Severity, number>
  chosen: Tile
  onChoose: (tile: Tile) => void
}) {
  const { t, lang } = useT()
  const format = new Intl.NumberFormat(lang)
  const total = counts.critical + counts.warning + counts.info
  const tiles: { tile: Tile; label: string; count: number }[] = [
    { tile: 'all', label: t('anomalies.all'), count: total },
    ...SEVERITIES.map((s) => ({ tile: s as Tile, label: t(TILE_LABEL[s]), count: counts[s] })),
  ]
  return (
    <div role="group" aria-label={t('anomaly.filter')} className="rounded-card bg-carbon-surface p-3 max-[600px]:p-2">
      <div className="flex flex-wrap justify-center gap-2 max-[860px]:grid max-[860px]:grid-cols-2 max-[600px]:flex max-[600px]:flex-nowrap max-[600px]:justify-start max-[600px]:overflow-x-auto">
        {tiles.map(({ tile, label, count }, i) => {
          const on = tile === chosen
          return (
            <button
              key={tile}
              type="button"
              aria-pressed={on}
              onClick={() => onChoose(tile)}
              style={hueVars(i) as CSSProperties}
              className={`glim-hue flex min-w-40 flex-1 items-center gap-2.5 rounded-card px-3 py-2 text-start transition-colors max-[860px]:min-w-0 max-[600px]:flex-none max-[600px]:rounded-[var(--radius-pill)] max-[600px]:py-1.5 ${
                on ? 'glim-active bg-accent text-accentContrast' : 'bg-carbon-surface2 text-carbon-text hover:bg-carbon-surface3'
              }`}
            >
              <span className="flex [&_svg]:h-5 [&_svg]:w-5 max-[600px]:hidden" aria-hidden>
                <IconAnomalies />
              </span>
              <span className="min-w-0 flex-1 truncate text-body font-semibold">{label}</span>
              <span className="glim-num text-body font-semibold">{format.format(count)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One finding as one row: a dot for its severity, the job, what happened and
 * when. A held job says so as a badge. The row opens the finding's window.
 */
function FindingRow({
  finding: f,
  places,
  closed,
  onOpen,
}: {
  finding: Finding
  places: [string, string]
  closed: boolean
  onOpen: () => void
}) {
  const { t } = useT()
  return (
    <li onClick={onOpen} className="glim-row flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 hover:bg-carbon-hover">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`} />
      <button type="button" className="flex min-w-0 flex-1 items-baseline gap-2 text-start">
        <span className="shrink-0 text-body font-medium text-carbon-text">{f.job}</span>
        <span className="min-w-0 truncate text-subline text-carbon-textSub">
          {t(`anomaly.kind.${f.kind}`)}: {shortLine(f, t, places)}
        </span>
      </button>
      {!closed && f.held && <Badge tone="warn">{t('anomaly.heldBadge')}</Badge>}
      {closed && f.outcome && <Badge tone="neutral">{t(`anomaly.outcome.${f.outcome}`)}</Badge>}
      <span className="w-28 shrink-0 text-end text-subline text-carbon-textSub max-sm:hidden">
        <Since when={closed && f.closed ? f.closed : f.since} />
      </span>
    </li>
  )
}

/**
 * One finding in a window: the whole sentence, its figures, the engine's own
 * words for a failure, the files a brake counted, and its answers. A held
 * job's answers are run and take back, the one usually meant last and filled;
 * a note is run or acknowledged, the fix last and filled.
 */
function FindingWindow({
  finding: f,
  places,
  onClose,
  onWatch,
  onAsk,
  onAcknowledge,
  onRun,
}: {
  finding: Finding
  places: [string, string]
  onClose: () => void
  onWatch: () => void
  onAsk: (how: 'run' | 'back') => void
  onAcknowledge: () => void
  onRun: () => void
}) {
  const { t } = useT()
  const openJob = useOpenJob()
  const paths = f.paths ?? []
  const more = (f.count ?? 0) - paths.length

  let answers
  if (!f.open) {
    answers = <Button label={t('common.close')} labelKey="common.close" onClick={onClose} />
  } else if (f.held) {
    const lead = leadingAnswer(f)
    const run = (
      <Button
        key="run"
        label={t('anomaly.run')}
        labelKey="anomaly.run"
        title={t('anomaly.runHint')}
        tone={lead === 'run' ? 'accent' : 'neutral'}
        onClick={() => onAsk('run')}
      />
    )
    const restore = (
      <Button
        key="restore"
        label={t('anomaly.restore')}
        labelKey="anomaly.restore"
        title={t('anomaly.restoreHint')}
        tone={lead === 'restore' ? 'accent' : 'neutral'}
        onClick={() => onAsk('back')}
      />
    )
    answers = lead === 'run' ? [restore, run] : [run, restore]
  } else {
    answers = (
      <>
        <Button
          label={t('anomaly.acknowledge')}
          labelKey="anomaly.acknowledge"
          title={t('anomaly.acknowledgeHint')}
          onClick={onAcknowledge}
        />
        <Button label={t('jobs.runNow')} labelKey="jobs.runNow" title={t('jobs.runNowHint')} tone="accent" onClick={onRun} />
      </>
    )
  }

  return (
    <Dialog
      title={`${f.job}: ${t(`anomaly.kind.${f.kind}`)}`}
      onClose={onClose}
      footer={
        <>
          <span className="me-auto flex flex-wrap gap-2">
            <Button label={t('anomaly.openJob')} labelKey="anomaly.openJob" onClick={() => openJob(f.job)} />
            <Button label={t('anomaly.monitoring')} labelKey="anomaly.monitoring" onClick={onWatch} />
          </span>
          {answers}
        </>
      }
    >
      <div className="flex flex-col gap-3 py-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={BADGE_TONE[f.severity]}>{t(`anomaly.severity.${f.severity}`)}</Badge>
          {f.open && f.held && (
            <span className="inline-flex items-center gap-1 text-subline text-statusWarn">
              {t('anomaly.held')}
              <InfoBubble tip={t('anomaly.heldHint')} />
            </span>
          )}
          {!f.open && f.outcome && <Badge tone="neutral">{t(`anomaly.outcome.${f.outcome}`)}</Badge>}
        </div>
        <p className="text-body text-carbon-text [overflow-wrap:anywhere]">{sentence(f, t, places)}</p>
        {figures(f, t).length > 0 && (
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-subline">
            {figures(f, t).map(([term, value]) => (
              <div key={term} className="inline-flex items-baseline gap-1.5">
                <dt className="text-carbon-textSub">{term}</dt>
                <dd className="glim-num font-medium text-carbon-text">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {/* The engine's own words for a failure, which name the cause. */}
        {f.kind === 'failing' && f.detail && <p className="break-all font-mono text-subline text-carbon-textMuted">{f.detail}</p>}
        {f.open && paths.length > 0 && (
          <section className="glim-well flex flex-col gap-2 rounded-card p-4">
            <h3 className="glim-eyebrow flex items-center gap-1.5">
              {t('anomaly.files')}
              <InfoBubble tip={t('anomaly.filesHint')} />
            </h3>
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {paths.map((path) => (
                <li key={path} dir="ltr" className="break-all text-start font-mono text-subline text-carbon-text">
                  {path}
                </li>
              ))}
              {more > 0 && <li className="text-subline text-carbon-textMuted">{t('anomaly.filesMore', { count: more })}</li>}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  )
}

/** A job's brakes: the global ones it follows, or its own two values. */
function Monitoring({ job, brakes }: { job: string; brakes: BrakeBook }) {
  const { t } = useT()
  const own = ownBrakes(
    brakes.jobs?.find((j) => j.name === job),
    brakes.global,
  )
  const set = (next: Partial<Pick<Brakes, 'brakePercent' | 'changePercent'>>) =>
    brakes.setOwn(job, { ...(own ?? brakes.global), ...next }, true)

  return (
    <div className="flex flex-col gap-3 py-1">
      {!own && (
        <p className="text-subline text-carbon-textSub">
          {t('anomaly.follows', {
            delete: brakes.global.brakePercent,
            change: brakes.global.changePercent,
            floor: brakes.global.brakeFloor,
          })}
        </p>
      )}
      <ToggleRow
        label={t('anomaly.ownBrakes')}
        hint={t('anomaly.ownBrakesHint')}
        checked={own !== null}
        disabled={brakes.jobs === null}
        onChange={(on) =>
          brakes.setOwn(
            job,
            on ? { brakePercent: brakes.global.brakePercent, changePercent: brakes.global.changePercent } : null,
            false,
          )
        }
      />
      {own && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('engine.brakePercent')} hint={t('engine.brakePercentHint')}>
            <NumberField
              value={own.brakePercent}
              min={0}
              max={100}
              label={t('engine.brakePercent')}
              onChange={(v) => set({ brakePercent: v })}
            />
          </Field>
          <Field label={t('engine.changePercent')} hint={t('engine.changePercentHint')}>
            <NumberField
              value={own.changePercent}
              min={0}
              max={100}
              label={t('engine.changePercent')}
              onChange={(v) => set({ changePercent: v })}
            />
          </Field>
        </div>
      )}
    </div>
  )
}
