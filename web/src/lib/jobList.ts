// How a list of jobs reads: each job's strip of last runs, its one status, and
// the filter, order and search above the list. Shaped by what it reads rather
// than by the API types, so the phone, whose api.ts declares its own, can
// share it.

type StripRun = { Err: string; Conflicts: number; Skipped: number }

/** One square of the strip: worked, worked but left something, failed, or no run. */
export type RunTone = 'ok' | 'warn' | 'fail' | 'none'

export const STRIP_LENGTH = 14

/**
 * A run that set a conflict aside or skipped a file worked, but left
 * something for a person, so it is orange rather than green.
 */
export function runTone(run: StripRun): RunTone {
  if (run.Err !== '') return 'fail'
  if (run.Conflicts > 0 || run.Skipped > 0) return 'warn'
  return 'ok'
}

/**
 * The tones of a job's last runs, oldest first, from runs given newest first.
 * The strip is padded at its old end, so a young job reads as new rather than
 * as one that missed its runs.
 */
export function runStrip(recent: StripRun[]): RunTone[] {
  const tones = recent.slice(0, STRIP_LENGTH).map(runTone).reverse()
  return [...Array<RunTone>(STRIP_LENGTH - tones.length).fill('none'), ...tones]
}

type ListedJob = { name: string; running: boolean; disabled: boolean; recent: (StripRun & { Started: string })[] }

/**
 * The one status a job's row shows, the loudest that applies. A job that ran
 * fine is `last`, which the row draws quietly as the time of that run, so a
 * held run or a conflict still waiting must win over it: a warning is never
 * rounded up to "synced".
 */
export type JobStatus = 'running' | 'held' | 'failed' | 'conflict' | 'paused' | 'never' | 'last'

/** What waits on a person for one job outside its own runs. */
export type JobWaits = { held: boolean; conflict: boolean }

export function jobStatus(job: ListedJob, waits: JobWaits): JobStatus {
  if (job.running) return 'running'
  if (waits.held) return 'held'
  if (job.recent[0] && job.recent[0].Err !== '') return 'failed'
  if (waits.conflict) return 'conflict'
  if (job.disabled) return 'paused'
  if (job.recent.length === 0) return 'never'
  return 'last'
}

/** What the filter keeps: everything, what runs now, what is paused, what needs a look. */
export type JobFilter = 'all' | 'running' | 'paused' | 'trouble'

export const JOB_FILTERS: JobFilter[] = ['all', 'running', 'paused', 'trouble']

export type JobSortField = 'name' | 'status' | 'lastRun'

/**
 * Each field has a natural order (A to Z, problems first, newest first), and
 * `reversed` turns it round.
 */
export type JobSort = { field: JobSortField; reversed: boolean }

export type JobView = { filter: JobFilter; sort: JobSort }

export const DEFAULT_VIEW: JobView = { filter: 'all', sort: { field: 'name', reversed: false } }

const TROUBLE: JobStatus[] = ['held', 'failed', 'conflict']

// Problems first, then work in progress, then what is quiet.
const STATUS_RANK: Record<JobStatus, number> = { held: 0, failed: 1, conflict: 2, running: 3, never: 4, paused: 5, last: 6 }

function keeps(filter: JobFilter, status: JobStatus): boolean {
  switch (filter) {
    case 'running':
      return status === 'running'
    case 'paused':
      return status === 'paused'
    case 'trouble':
      return TROUBLE.includes(status)
    default:
      return true
  }
}

/**
 * The jobs the list shows, in its order. The search matches the name and both
 * sides, case aside, since a job is as often found by the folder it syncs.
 */
export function jobsInView<J extends ListedJob & { left: string; right: string }>(
  jobs: J[],
  view: JobView,
  query: string,
  waits: (name: string) => JobWaits,
): J[] {
  const needle = query.trim().toLocaleLowerCase()
  const status = new Map(jobs.map((j) => [j.name, jobStatus(j, waits(j.name))]))
  const last = (j: J) => (j.recent[0] ? Date.parse(j.recent[0].Started) : 0)
  const byName = (a: J, b: J) => a.name.localeCompare(b.name)
  const order: Record<JobSortField, (a: J, b: J) => number> = {
    name: byName,
    status: (a, b) => STATUS_RANK[status.get(a.name)!] - STATUS_RANK[status.get(b.name)!] || byName(a, b),
    lastRun: (a, b) => last(b) - last(a) || byName(a, b),
  }
  const compare = order[view.sort.field]
  return jobs
    .filter((j) => keeps(view.filter, status.get(j.name)!))
    .filter((j) => !needle || [j.name, j.left, j.right].some((s) => s.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (view.sort.reversed ? -compare(a, b) : compare(a, b)))
}
