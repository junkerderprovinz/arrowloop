import { Badge, Button, Card, Empty, Num, Rule } from '../components/Shell'
import type { Job, Run } from '../lib/api'

/**
 * The job list answers the question a person actually has, which is not "when
 * did this last run" but "when did this last WORK". A job failing every quarter
 * of an hour looks busy in a log while being of no use at all.
 */
export function Jobs({ jobs, onPreview }: { jobs: Job[]; onPreview: (name: string) => void }) {
  if (jobs.length === 0) {
    return (
      <Card title="Jobs">
        <Empty>No jobs are configured. Add one to reeveroll.json and reload.</Empty>
      </Card>
    )
  }
  return (
    <Card title="Jobs">
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
                <p className="mt-0.5 truncate text-[11px] text-carbon-textMuted" title={`${j.left} to ${j.right}`}>
                  {j.left} <span aria-hidden>&harr;</span> {j.right}
                </p>
              </div>

              <span className="hidden shrink-0 text-[11px] text-carbon-textMuted md:inline">
                {j.disabled ? 'disabled' : j.schedule || 'on request'}
              </span>

              <span className="shrink-0 text-[11px] text-carbon-textMuted">
                {j.lastSuccess ? <Since when={j.lastSuccess} /> : 'never worked'}
              </span>

              {/* The primary action for a row stays visible; it is the one
                  thing somebody came to this row to do. */}
              <Button onClick={() => onPreview(j.name)}>Preview</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function State({ job }: { job: Job }) {
  if (job.running) return <Badge tone="accent">running</Badge>
  if (job.disabled) return <Badge tone="neutral">disabled</Badge>
  if (!job.lastSuccess) return <Badge tone="neutral">waiting</Badge>
  return <Badge tone="ok">settled</Badge>
}

/**
 * A stamp on its own is a number somebody has to subtract from today. "Two days
 * ago" is the thing they were going to work out anyway, and the exact time
 * stays available on hover for when it matters.
 */
export function Since({ when }: { when: string }) {
  const then = new Date(when)
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000)
  const steps: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [365, 'day'],
  ]
  let value = seconds
  let unit = 'second'
  for (const [size, name] of steps) {
    if (value < size) {
      unit = name
      break
    }
    value /= size
    unit = name
  }
  const rounded = Math.floor(value)
  return (
    <span title={then.toLocaleString()}>
      <Num>{rounded}</Num> {unit}
      {rounded === 1 ? '' : 's'} ago
    </span>
  )
}

/** The run log, newest first. */
export function History({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return (
      <Card title="History">
        <Empty>Nothing has run yet.</Empty>
      </Card>
    )
  }
  return (
    <Card title="History">
      <ul className="flex flex-col">
        {runs.map((r, i) => (
          <li key={`${r.Job}-${r.Started}-${i}`}>
            {i > 0 && <Rule />}
            <div className="flex items-center gap-3 py-2.5 text-[12px]">
              <Badge tone={r.Err ? 'fail' : 'ok'}>{r.Err ? 'failed' : 'ok'}</Badge>
              <span className="w-32 shrink-0 truncate font-medium">{r.Job}</span>
              <span className="shrink-0 text-[11px] text-carbon-textMuted">
                <Since when={r.Started} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-carbon-textMuted">
                {r.Err ? (
                  r.Err
                ) : (
                  <>
                    <Num>{r.Copied}</Num> copied, <Num>{r.Moved}</Num> moved, <Num>{r.Trashed}</Num> trashed,{' '}
                    <Num>{r.Conflicts}</Num> conflicts
                    {r.Skipped > 0 && (
                      <>
                        , <Num>{r.Skipped}</Num> left for later
                      </>
                    )}
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
