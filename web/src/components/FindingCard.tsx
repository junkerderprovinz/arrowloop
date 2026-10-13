import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { FailureText } from './FailureText'
import { Since } from './Since'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { ConfirmWindow } from './ConfirmWindow'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { figures, leadingAnswer, sentence, type Finding, type Severity } from '../lib/anomalies'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { useOpenJob } from '../lib/openJob'
import { useToast } from '../lib/toast'

/** How many of the files a brake counted the card names; the rest are counted. */
const SHOWN_FILES = 10

const BADGE_TONE: Record<Severity, 'fail' | 'warn' | 'neutral'> = {
  critical: 'fail',
  warning: 'warn',
  info: 'neutral',
}

// The bar on the leading edge, which flips sides with the reading direction.
const EDGE: Record<Severity, string> = {
  critical:
    'bg-carbon-surface2 shadow-[inset_3px_0_0_var(--status-fail-solid)] rtl:shadow-[inset_-3px_0_0_var(--status-fail-solid)]',
  warning:
    'bg-carbon-surface2 shadow-[inset_3px_0_0_var(--status-warn-solid)] rtl:shadow-[inset_-3px_0_0_var(--status-warn-solid)]',
  info: 'bg-carbon-surface2 shadow-[inset_3px_0_0_var(--carbon-surface3)] rtl:shadow-[inset_-3px_0_0_var(--carbon-surface3)]',
}

/**
 * One finding with everything it has to say and its answers, as BombVault lays
 * a finding out: how bad it is, the job, what happened, the figures, the files
 * a brake counted, and the way out. Nothing opens over it. A held job is run
 * anyway or taken back, both of which ask first; a note is acknowledged or the
 * job is run.
 *
 * Every card starts at the height of the plainest one, its head, one sentence
 * and its answers, so a list of them reads as one; a card with more to say
 * opens in place.
 */
export function FindingCard({
  finding: f,
  lead = false,
  onJobPage = false,
  onChanged,
  onAllowed,
}: {
  finding: Finding
  /** The first card on the page, whose answer is the view's one filled button. */
  lead?: boolean
  /** The card stands on its job's own page, which needs no way to open it. */
  onJobPage?: boolean
  /** Asks for the findings again once an answer went out. */
  onChanged?: () => void
  /** Called when a held change is let run, so a refusal after it can say so. */
  onAllowed?: (job: string) => void
}) {
  const { t } = useT()
  const push = useToast()
  const openJob = useOpenJob()
  const [asking, setAsking] = useState<'run' | 'back' | null>(null)
  // A card on its job's page stands alone and says everything at once.
  const [expanded, setExpanded] = useState(onJobPage)
  const said = useRef<HTMLParagraphElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  // Whether the sentence is cut short, which is more to say on its own.
  const [cut, setCut] = useState(false)
  const places: [string, string] = [t('side.left'), t('side.right')]
  const paths = (f.paths ?? []).slice(0, SHOWN_FILES)
  const unnamed = (f.count ?? 0) - paths.length
  const shown = figures(f, t)
  const failure = f.kind === 'failing' && !!f.detail
  const files = f.open && paths.length > 0

  useLayoutEffect(() => {
    const el = said.current
    if (!el || expanded) return
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [expanded, f])
  useEffect(() => {
    toggle.current?.setAttribute('aria-expanded', String(expanded))
  }, [expanded, cut])
  const more = shown.length > 0 || failure || files || cut || expanded

  const answer = (how: 'run' | 'back') => {
    if (how === 'run') onAllowed?.(f.job)
    api
      .answerAnomaly(f.id, how)
      .then(() => push(t('anomaly.started', { job: f.job })))
      .catch((e: Error) => push(e.message, 'fail'))
      .finally(() => onChanged?.())
  }
  const acknowledge = () =>
    api
      .acknowledgeAnomaly(f.id)
      .then(() => push(t('anomaly.acknowledged')))
      .catch((e: Error) => push(e.message, 'fail'))
      .finally(() => onChanged?.())
  const runNow = () =>
    api
      .run(f.job)
      .then(() => push(t('anomaly.started', { job: f.job })))
      .catch((e: Error) => push(e.message, 'fail'))

  const open = (
    <Button key="open" label={t('anomaly.openJob')} labelKey="anomaly.openJob" onClick={() => openJob(f.job)} />
  )
  let start = null
  let end = [open]
  if (f.open && f.held) {
    const leading = leadingAnswer(f)
    const run = (
      <Button
        key="run"
        label={t('anomaly.run')}
        labelKey="anomaly.run"
        title={t('anomaly.runHint')}
        tone={lead && leading === 'run' ? 'accent' : 'neutral'}
        onClick={() => setAsking('run')}
      />
    )
    const restore = (
      <Button
        key="restore"
        label={t('anomaly.restore')}
        labelKey="anomaly.restore"
        title={t('anomaly.restoreHint')}
        tone={lead && leading === 'restore' ? 'accent' : 'neutral'}
        onClick={() => setAsking('back')}
      />
    )
    // The answer usually meant stands last, where the way forward goes.
    end = leading === 'run' ? [open, restore, run] : [open, run, restore]
  } else if (f.open && f.kind === 'unusual') {
    // The run already happened, so there is nothing to run again; the job's
    // page shows what is usual for it.
    start = (
      <Button
        label={t('anomaly.acknowledge')}
        labelKey="anomaly.acknowledge"
        title={t('anomaly.acknowledgeHint')}
        onClick={() => void acknowledge()}
      />
    )
    end = [
      <Button
        key="open"
        label={t('anomaly.openJob')}
        labelKey="anomaly.openJob"
        tone={lead ? 'accent' : 'neutral'}
        onClick={() => openJob(f.job)}
      />,
    ]
  } else if (f.open) {
    start = (
      <Button
        label={t('anomaly.acknowledge')}
        labelKey="anomaly.acknowledge"
        title={t('anomaly.acknowledgeHint')}
        onClick={() => void acknowledge()}
      />
    )
    end = [
      open,
      <Button
        key="run"
        label={t('jobs.runNow')}
        labelKey="jobs.runNow"
        title={t('jobs.runNowHint')}
        tone={lead ? 'accent' : 'neutral'}
        onClick={() => void runNow()}
      />,
    ]
  }

  return (
    <li id={`finding-${f.id}`} className={`flex min-w-0 scroll-mt-10 flex-col gap-2 rounded-card px-4 pb-3.5 pt-3 max-sm:px-3 ${EDGE[f.severity]}`}>
      <div className="flex flex-wrap items-center gap-2">
        {!f.open && f.outcome && <Badge tone="neutral">{t(`anomaly.outcome.${f.outcome}`)}</Badge>}
        <Badge tone={BADGE_TONE[f.severity]}>{t(`anomaly.severity.${f.severity}`)}</Badge>
        <span className="min-w-0 text-title font-semibold text-carbon-text [overflow-wrap:anywhere]">{f.job}</span>
        <span className="text-subline text-carbon-textSub">{t(`anomaly.kind.${f.kind}`)}</span>
        {f.open && f.held && (
          <span className="inline-flex items-center gap-1">
            <Badge tone="warn">{t('status.held')}</Badge>
            <InfoBubble tip={t('anomaly.heldHint')} />
          </span>
        )}
        <span className="ms-auto shrink-0 text-subline text-carbon-textMuted">
          {t(f.open ? 'anomaly.sinceLabel' : 'anomaly.closedLabel')} <Since when={!f.open && f.closed ? f.closed : f.since} />
        </span>
      </div>

      {/* One line where there is room for the card to keep its height, two
          on a phone, where a single line would say too little. */}
      <p
        ref={said}
        className={`text-body text-carbon-text [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-1 max-sm:line-clamp-2 max-sm:min-h-[2lh]'}`}
      >
        {sentence(f, t, places)}
      </p>

      {expanded && (
        <div className="flex flex-col gap-2">
          {shown.length > 0 && (
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-subline">
              {shown.map(([term, value]) => (
                <div key={term} className="inline-flex items-baseline gap-1.5">
                  <dt className="text-carbon-textSub">{term}</dt>
                  <dd className="glim-num font-medium text-carbon-text">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* What the last failure was about, which names the cause. */}
          {failure && f.detail && <FailureText raw={f.detail} failure={f.failure} className="text-carbon-text" />}

          {files && (
            <section className="flex flex-col gap-1">
              <h3 className="glim-eyebrow flex items-center gap-1.5">
                {t('anomaly.files')}
                <InfoBubble tip={t('anomaly.filesHint')} />
              </h3>
              <ul className="flex flex-col gap-0.5">
                {paths.map((path) => (
                  <li key={path} dir="ltr" className="text-start font-mono text-subline text-carbon-text [overflow-wrap:anywhere]">
                    {path}
                  </li>
                ))}
                {unnamed > 0 && <li className="text-subline text-carbon-textMuted">{t('anomaly.filesMore', { count: unnamed })}</li>}
              </ul>
            </section>
          )}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          {start}
          {more && (
            <Button
              ref={toggle}
              label={t(expanded ? 'anomaly.showLess' : 'anomaly.showMore')}
              labelKey={expanded ? 'anomaly.showLess' : 'anomaly.showMore'}
              onClick={() => setExpanded((was) => !was)}
            />
          )}
        </span>
        <span className="flex flex-wrap items-center justify-end gap-2">
          {onJobPage ? end.filter((button) => button.key !== 'open') : end}
        </span>
      </div>

      {asking && (
        <ConfirmWindow
          title={t(asking === 'run' ? 'anomaly.runAsk' : 'anomaly.restoreAsk', { job: f.job })}
          message={
            asking === 'run'
              ? sentence(f, t, places) + ' ' + t('anomaly.runHint')
              : f.kind === 'empty'
                ? t('anomaly.restoreEmpty', { place: places[f.side === 'right' ? 1 : 0] }) + ' ' + t('anomaly.restoreHint')
                : t('anomaly.restoreHint')
          }
          confirmLabel={t(asking === 'run' ? 'anomaly.run' : 'anomaly.restore')}
          confirmLabelKey={asking === 'run' ? 'anomaly.run' : 'anomaly.restore'}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            answer(asking)
            setAsking(null)
          }}
        />
      )}
    </li>
  )
}
