// How a job reads in a list: its strip of last runs and its one status. Shaped
// by what it reads rather than by the API types, so the phone, whose api.ts
// declares its own, can share it.

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
 * held run, a conflict still waiting, a note or a last run that skipped files
 * must win over it: a warning is never rounded up to "synced".
 */
export type JobStatus = 'running' | 'held' | 'failed' | 'conflict' | 'warned' | 'paused' | 'never' | 'last'

/**
 * What waits on a person for one job outside its own runs. `notes` is a
 * finding about the job that does not hold it.
 */
export type JobWaits = { held: boolean; conflict: boolean; notes: boolean }

export function jobStatus(job: ListedJob, waits: JobWaits): JobStatus {
  if (job.running) return 'running'
  if (waits.held) return 'held'
  if (job.recent[0] && job.recent[0].Err !== '') return 'failed'
  if (waits.conflict) return 'conflict'
  if (waits.notes || (job.recent[0]?.Skipped ?? 0) > 0) return 'warned'
  if (job.disabled) return 'paused'
  if (job.recent.length === 0) return 'never'
  return 'last'
}
