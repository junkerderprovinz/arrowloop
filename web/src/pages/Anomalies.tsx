// The Anomalies page: one card per job with open findings, because the question
// somebody brings is which job is in trouble and what to press. Jobs without
// findings keep their brakes in one card below, and what was closed lately sits
// in a row under that. The layout is BombVault's, so a finding reads the same
// in both apps.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { Field, NumberField } from '../components/Field'
import { Stack } from '../components/Shell'
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
  groupFindings,
  leadingAnswer,
  ownBrakes,
  sentence,
  shortLine,
  type Brakes,
  type Finding,
  type FindingGroup,
  type FindingListing,
  type Severity,
} from '../lib/anomalies'
import { api, type Job, type RawJob } from '../lib/api'
import { hueVars } from '../lib/appearance'
import { useGoTo } from '../lib/goTo'
import { useT, type TranslationKey } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { Since } from './Jobs'

const TILE_LABEL: Record<Severity, TranslationKey> = {
  critical: 'anomaly.severity.critical',
  warning: 'anomaly.tile.warning',
  info: 'anomaly.tile.info',
}

const NUMBER_TONE: Record<Severity, string> = {
  critical: 'text-statusFail',
  warning: 'text-statusWarn',
  info: 'text-carbon-text',
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

/** The fold arrow, pointing along the reading direction and down when open. */
function Disclosure({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`transition-transform ${open ? 'rotate-90' : 'rtl:rotate-180'}`}
    >
      <path fill="currentColor" d="M4 1.3 8.5 6 4 10.7Z" />
    </svg>
  )
}

/**
 * Each job's own brakes, read from the configuration and written back to it. A
 * typed value waits to settle, since every save makes the engine reload.
 */
function useBrakes() {
  const [jobs, setJobs] = useState<RawJob[] | null>(null)
  const [global, setGlobal] = useState<Brakes>(() => globalBrakes(undefined))
  const [error, setError] = useState<string | null>(null)
  const latest = useRef<RawJob[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api
      .config()
      .then((got) => setJobs(got.jobs))
      .catch((e: Error) => setError(e.message))
    api
      .settings()
      .then((got) => setGlobal(globalBrakes(got.defaults)))
      .catch(() => {})
  }, [])

  const commit = useCallback(() => {
    timer.current = null
    if (!latest.current) return
    api
      .saveConfig(latest.current)
      .then(() => setError(null))
      .catch((e: Error) => setError(e.message))
  }, [])

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

  return { jobs, global, setOwn, error }
}

type BrakeBook = ReturnType<typeof useBrakes>

export function Anomalies({
  listing,
  jobs,
  job: focus,
  refused,
  onChanged,
}: {
  /** Null until the first answer arrives. */
  listing: FindingListing | null
  jobs: Job[]
  /** The job whose card opens, when another screen sent somebody here for it. */
  job: string
  /** How often a brake has refused each job since the page loaded. */
  refused: Record<string, number>
  onChanged: () => void
}) {
  const { t } = useT()
  const push = useToast()
  const brakes = useBrakes()
  const [hidden, setHidden] = useState<Set<Severity>>(new Set())
  const [asking, setAsking] = useState<{ finding: Finding; answer: 'run' | 'back' } | null>(null)
  // The jobs whose refused change was let run, with the refusals counted then.
  const allowed = useRef(new Map<string, number>())

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
  const groups = groupFindings(open.filter((f) => !hidden.has(f.severity)))
  const loud = new Set(open.map((f) => f.job))
  const quiet = jobs.filter((j) => !loud.has(j.name))
  const places: [string, string] = [t('side.left'), t('side.right')]

  function toggle(severity: Severity) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(severity)) next.delete(severity)
      else next.add(severity)
      return next
    })
  }

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
      {listing === null ? (
        <p className="text-body text-carbon-textSub">{t('history.working')}</p>
      ) : (
        <>
          <SeverityTiles counts={countBySeverity(open)} hidden={hidden} onToggle={toggle} />
          {open.length === 0 ? (
            <p className="text-body text-carbon-textSub">{t('anomaly.none')}</p>
          ) : groups.length === 0 ? (
            <p className="text-body text-carbon-textSub">{t('anomaly.noneShown')}</p>
          ) : (
            groups.map((g, i) => (
              <FindingCard
                key={g.job}
                group={g}
                places={places}
                hueIndex={i}
                focused={focus === g.job}
                brakes={brakes}
                onAsk={(finding, how) => setAsking({ finding, answer: how })}
                onAcknowledge={acknowledge}
                onRun={runNow}
              />
            ))
          )}
        </>
      )}

      {brakes.error && <p className="text-subline text-statusFail">{brakes.error}</p>}

      {listing !== null && quiet.length > 0 && (
        <Card title={`${t('anomaly.quiet')} · ${quiet.length}`} hint={t('anomaly.quietHint')} hueIndex={groups.length}>
          <ul className="grid gap-x-8 md:grid-cols-2">
            {quiet.map((j) => (
              <QuietRow key={j.name} job={j.name} brakes={brakes} focused={focus === j.name} />
            ))}
          </ul>
        </Card>
      )}

      {listing !== null && <ClosedRow closed={listing.closed} places={places} />}

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
          }}
        />
      )}
    </Stack>
  )
}

/**
 * The tiles count the open findings by severity and are the only filter: a
 * press hides that severity and a second one brings it back.
 */
function SeverityTiles({
  counts,
  hidden,
  onToggle,
}: {
  counts: Record<Severity, number>
  hidden: Set<Severity>
  onToggle: (severity: Severity) => void
}) {
  const { t, lang } = useT()
  const format = new Intl.NumberFormat(lang)
  return (
    <div role="group" aria-label={t('anomaly.filter')} className="grid grid-cols-3 gap-2 sm:gap-4">
      {SEVERITIES.map((severity, i) => {
        const shown = !hidden.has(severity)
        return (
          <button
            key={severity}
            type="button"
            aria-pressed={shown}
            onClick={() => onToggle(severity)}
            style={hueVars(i) as CSSProperties}
            className={`glim-hue glim-tint${shown ? ' glim-active' : ''} flex min-w-0 flex-col items-start gap-0.5 rounded-card bg-carbon-surface px-3 py-2.5 text-start hover:bg-carbon-surface2 sm:px-4 sm:py-3`}
          >
            <span
              className={`glim-num text-status font-semibold leading-tight ${shown ? NUMBER_TONE[severity] : 'text-carbon-textMuted'}`}
            >
              {format.format(counts[severity])}
            </span>
            <span className={`min-w-0 text-body [overflow-wrap:anywhere] ${shown ? 'text-carbon-text' : 'text-carbon-textMuted'}`}>
              {t(TILE_LABEL[severity])}
            </span>
            <span aria-hidden="true" className="min-w-0 text-subline text-carbon-textSub [overflow-wrap:anywhere]">
              {t(shown ? 'anomaly.tile.shown' : 'anomaly.tile.hidden')}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** A held job says so wherever its finding's line is closed. */
function HeldNote() {
  const { t } = useT()
  return (
    <p className="inline-flex items-center gap-1 self-start text-subline text-statusWarn">
      {t('anomaly.held')}
      <InfoBubble tip={t('anomaly.heldHint')} />
    </p>
  )
}

function FindingCard({
  group,
  places,
  hueIndex,
  focused,
  brakes,
  onAsk,
  onAcknowledge,
  onRun,
}: {
  group: FindingGroup
  places: [string, string]
  hueIndex: number
  focused: boolean
  brakes: BrakeBook
  onAsk: (finding: Finding, how: 'run' | 'back') => void
  onAcknowledge: (finding: Finding) => void
  onRun: (finding: Finding) => void
}) {
  const { t } = useT()
  const box = useRef<HTMLElement>(null)
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(focused ? group.findings.map((f) => f.id) : []))
  const [monitoring, setMonitoring] = useState(false)

  useEffect(() => {
    if (!focused) return
    box.current?.scrollIntoView({ block: 'start' })
  }, [focused])

  const held = group.findings.find((f) => f.held)
  const first = held ?? group.findings[0]

  function toggleLine(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // A held job has two answers, run or take back; a note is acknowledged or
  // the job is run. The one usually meant stands last, in the accent.
  let answers: ReactNode
  if (held) {
    const lead = leadingAnswer(held)
    const run = (
      <Button
        key="run"
        label={t('anomaly.run')}
        labelKey="anomaly.run"
        title={t('anomaly.runHint')}
        tone={lead === 'run' ? 'accent' : 'neutral'}
        onClick={() => onAsk(held, 'run')}
      />
    )
    const restore = (
      <Button
        key="restore"
        label={t('anomaly.restore')}
        labelKey="anomaly.restore"
        title={t('anomaly.restoreHint')}
        tone={lead === 'restore' ? 'accent' : 'neutral'}
        onClick={() => onAsk(held, 'back')}
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
          tone="neutral"
          onClick={() => onAcknowledge(first)}
        />
        <Button
          label={t('jobs.runNow')}
          labelKey="jobs.runNow"
          title={t('jobs.runNowHint')}
          tone="accent"
          onClick={() => onRun(first)}
        />
      </>
    )
  }

  return (
    <section
      ref={box}
      aria-label={group.job}
      style={{
        ...(hueVars(hueIndex) as CSSProperties),
        // The wash is translucent, so it goes over the card's own surface.
        ...(group.worst === 'critical'
          ? { backgroundImage: 'linear-gradient(var(--status-fail-bg), var(--status-fail-bg))' }
          : {}),
      }}
      className="glim-hue glim-notch-card relative flex scroll-mt-10 flex-col gap-1 rounded-card bg-carbon-surface p-5 pt-6"
    >
      {/* Two heading badges in the flow of one positioned h2, so the pair stays
          on the card's top edge when a long name wraps. */}
      <h2 className="absolute top-0 z-10 flex max-w-[calc(100%-2.5rem)] -translate-y-1/2 items-center gap-1.5">
        <Badge tone="heading" size="heading" inFlow wrap hueIndex={hueIndex} className="min-w-0">
          {/* A job's name is an identifier, so it keeps its own case. */}
          <span className="min-w-0 normal-case tracking-normal [overflow-wrap:anywhere]">{group.job}</span>
        </Badge>
        <Badge tone={BADGE_TONE[group.worst]} size="heading" className="shrink-0">
          {t(`anomaly.severity.${group.worst}`)}
        </Badge>
      </h2>

      <p className="text-subline text-carbon-textSub">{t('anomaly.open', { count: group.findings.length })}</p>

      <div className="flex flex-col">
        {group.findings.map((f, i) => (
          <div key={f.id}>
            {i > 0 && <div className="h-px w-full" style={{ background: 'var(--hairline)' }} />}
            <FindingLine finding={f} places={places} open={openIds.has(f.id)} onToggle={() => toggleLine(f.id)} />
          </div>
        ))}
      </div>

      {held && !openIds.has(held.id) && <HeldNote />}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setMonitoring(!monitoring)}
          aria-expanded={monitoring}
          className="-mx-1 flex min-h-11 items-center gap-1.5 rounded-control px-1 text-meta text-carbon-textSub hover:text-carbon-text"
        >
          {t('anomaly.monitoring')}
          <Disclosure open={monitoring} />
        </button>
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2">{answers}</div>
      </div>

      {monitoring && <Monitoring job={group.job} brakes={brakes} />}
    </section>
  )
}

/**
 * One finding as a line: a dot for its severity, what happened, when, and the
 * fold arrow. Opened, it says the whole sentence, the figures and the files.
 * The card around it names the job, so only a closed finding's line does.
 */
function FindingLine({
  finding: f,
  places,
  open,
  onToggle,
  closed = false,
}: {
  finding: Finding
  places: [string, string]
  open: boolean
  onToggle: () => void
  closed?: boolean
}) {
  const { t } = useT()
  const goTo = useGoTo()
  const [files, setFiles] = useState(false)
  const paths = f.paths ?? []
  const more = (f.count ?? 0) - paths.length

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="-mx-2 flex min-h-11 items-start gap-3 rounded-control px-2 py-2.5 text-start hover:bg-carbon-hover"
      >
        <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`} />
        <span className="min-w-0 flex-1 text-body text-carbon-text [overflow-wrap:anywhere]">
          {closed && <span className="font-medium">{f.job}: </span>}
          <span className="text-carbon-textSub">{t(`anomaly.kind.${f.kind}`)}: </span>
          {shortLine(f, t, places)}
        </span>
        {closed && f.outcome && (
          <span className="mt-0.5 shrink-0 text-subline text-carbon-textSub">{t(`anomaly.outcome.${f.outcome}`)}</span>
        )}
        <span className="mt-0.5 shrink-0 text-subline text-carbon-textSub max-sm:hidden">
          <Since when={closed && f.closed ? f.closed : f.since} />
        </span>
        <span className="mt-1 shrink-0 text-carbon-textSub">
          <Disclosure open={open} />
        </span>
      </button>

      {open && (
        <div className="glim-content-fade flex flex-col gap-2 pb-3 ps-5">
          <p className="text-body text-carbon-textSub [overflow-wrap:anywhere]">{sentence(f, t, places)}</p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-subline">
            {figures(f, t).map(([term, value]) => (
              <span key={term} className="inline-flex items-baseline gap-1.5">
                <span className="text-carbon-textSub">{term}</span>
                <span className="glim-num font-medium text-carbon-text">{value}</span>
              </span>
            ))}
          </div>

          {/* The engine's own words for a failure, which name the cause. */}
          {f.kind === 'failing' && f.detail && (
            <p className="break-all font-mono text-subline text-carbon-textMuted">{f.detail}</p>
          )}

          {!closed && paths.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFiles(!files)}
                  aria-expanded={files}
                  className="-mx-1 flex min-h-9 items-center gap-1.5 rounded-control px-1 text-meta text-carbon-textSub hover:text-carbon-text"
                >
                  <Disclosure open={files} />
                  {t('anomaly.files')}
                </button>
                <InfoBubble tip={t('anomaly.filesHint')} />
              </div>
              {files && (
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                  {paths.map((path) => (
                    <li key={path} dir="ltr" className="break-all text-start font-mono text-subline text-carbon-text">
                      {path}
                    </li>
                  ))}
                  {more > 0 && <li className="text-subline text-carbon-textMuted">{t('anomaly.filesMore', { count: more })}</li>}
                </ul>
              )}
            </div>
          )}

          {!closed && f.held && <HeldNote />}

          {!closed && (
            <button
              type="button"
              onClick={() => goTo({ tab: 'jobs', job: f.job })}
              className="self-start text-meta text-accentInk hover:underline"
            >
              {t('anomaly.openJob')}
            </button>
          )}
        </div>
      )}
    </div>
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
    <div className="glim-content-fade flex flex-col gap-3 pb-2 pt-1">
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

function QuietRow({ job, brakes, focused }: { job: string; brakes: BrakeBook; focused: boolean }) {
  const [open, setOpen] = useState(focused)
  return (
    <li className="flex min-w-0 flex-col">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="-mx-2 flex min-h-11 items-center gap-2 rounded-control px-2 py-1.5 text-start hover:bg-carbon-hover"
      >
        <span className="min-w-0 flex-1 text-body text-carbon-text [overflow-wrap:anywhere]">{job}</span>
        <span className="shrink-0 text-carbon-textSub">
          <Disclosure open={open} />
        </span>
      </button>
      {open && <Monitoring job={job} brakes={brakes} />}
    </li>
  )
}

function ClosedRow({ closed, places }: { closed: Finding[]; places: [string, string] }) {
  const { t, lang } = useT()
  const [open, setOpen] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  function toggleLine(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="flex flex-col rounded-card bg-carbon-surface px-5 py-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="-mx-2 flex min-h-12 items-center gap-3 rounded-control px-2 text-start hover:bg-carbon-hover"
      >
        <span className="text-carbon-textSub">
          <Disclosure open={open} />
        </span>
        <span className="min-w-0 flex-1 text-body text-carbon-text">{t('anomaly.closed')}</span>
        <span className="glim-num shrink-0 text-body text-carbon-textSub">{new Intl.NumberFormat(lang).format(closed.length)}</span>
      </button>
      {open && (
        <div className="glim-content-fade flex flex-col pb-2">
          {closed.length === 0 ? (
            <p className="py-2 text-body text-carbon-textSub">{t('anomaly.noneClosed')}</p>
          ) : (
            closed.map((f) => (
              <FindingLine
                key={f.id}
                finding={f}
                places={places}
                closed
                open={openIds.has(f.id)}
                onToggle={() => toggleLine(f.id)}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
}
