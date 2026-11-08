// What the Overview says about the whole install in one line. Shaped by what it
// reads rather than by the API types, so the phone, whose api.ts declares its
// own, can share it.

type HeadRun = { Err: string; Finished: string }

type HeadJob = { running: boolean; disabled: boolean; nextRun?: string; recent: HeadRun[] }

export type Headline = 'empty' | 'needs' | 'running' | 'notes' | 'allGood'

/** A job whose newest run failed and that is not running again already. */
export function failing(job: HeadJob): boolean {
  return !job.running && (job.recent[0]?.Err ?? '') !== ''
}

/**
 * The headline and how many things wait for the person. A failed run, an open
 * conflict and a finding that holds a job need somebody, and they win over a
 * run in progress: a warning is never rounded up to "all is well".
 */
export function headOf({
  jobs,
  conflicts,
  held,
  notes,
}: {
  jobs: HeadJob[]
  conflicts: number
  /** Findings that hold a job. */
  held: number
  /** Findings that only note something. */
  notes: number
}): { headline: Headline; needs: number } {
  if (jobs.length === 0) return { headline: 'empty', needs: 0 }
  const needs = jobs.filter(failing).length + conflicts + held
  if (needs > 0) return { headline: 'needs', needs }
  if (jobs.some((j) => j.running)) return { headline: 'running', needs }
  if (notes > 0) return { headline: 'notes', needs }
  return { headline: 'allGood', needs }
}

/** The newest finished run of any job, and the soonest a schedule starts one of the jobs that are not paused. */
export function lastAndNext(jobs: HeadJob[]): { last: string | null; next: string | null } {
  let last: string | null = null
  let next: string | null = null
  for (const job of jobs) {
    const ended = job.recent[0]?.Finished
    if (ended && (!last || Date.parse(ended) > Date.parse(last))) last = ended
    if (job.nextRun && !job.disabled && (!next || Date.parse(job.nextRun) < Date.parse(next))) next = job.nextRun
  }
  return { last, next }
}
