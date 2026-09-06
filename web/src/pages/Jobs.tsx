import { Badge, Button, Card, Empty, Num, Rule } from '../components/Shell'
import { IconPreview } from '../components/glyphs'
import { DirectionMark } from '../components/Direction'
import type { Job, Run, RunEvent } from '../lib/api'
import { useT, type TranslationKey } from '../lib/i18n'

/**
 * The job list answers the question a person actually has, which is not "when
 * did this last run" but "when did this last WORK". A job failing every quarter
 * of an hour looks busy in a log while being of no use at all.
 */
export function Jobs({
  jobs,
  progress,
  onPreview,
}: {
  jobs: Job[]
  progress: Record<string, RunEvent>
  onPreview: (name: string) => void
}) {
  const { t } = useT()
  if (jobs.length === 0) {
    return (
      <Card title={t('jobs.title')} hue={0}>
        <Empty>{t('jobs.empty')}</Empty>
      </Card>
    )
  }
  return (
    <Card title={t('jobs.title')} hue={0}>
      <ul className="flex flex-col">
        {jobs.map((j, i) => (
          <li key={j.name}>
            {i > 0 && <Rule />}
            <div className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{j.name}</span>
                  <State job={j} />
                </div>
                {/* The arrow sits between the two sides because that is where
                    the question is: which way does this go. */}
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-carbon-textMuted">
                  <span className="min-w-0 flex-1 truncate text-right" title={j.left}>
                    {j.left}
                  </span>
                  <DirectionMark direction={j.direction} />
                  <span className="min-w-0 flex-1 truncate" title={j.right}>
                    {j.right}
                  </span>
                </p>
                {j.running && <Progress event={progress[j.name]} />}
              </div>

              <span className="hidden shrink-0 text-[11px] text-carbon-textMuted md:inline">
                {j.disabled ? t('jobs.state.disabled') : j.schedule || t('jobs.schedule.onRequest')}
              </span>

              <span className="shrink-0 text-[11px] text-carbon-textMuted">
                {j.lastSuccess ? <Since when={j.lastSuccess} /> : t('jobs.neverWorked')}
              </span>

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
        ))}
      </ul>
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
