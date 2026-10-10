import type { RawJob, Settings } from './api'

/**
 * The fields a job leaves to the global sync settings by not setting them, the
 * ones `applyTo` in internal/job/job.go fills in. A job follows while it sets
 * none of them.
 */
export const FOLLOWED = ['direction', 'mode', 'schedule', 'emptyDirs', 'metadata'] as const

export function followsDefaults(job: RawJob): boolean {
  return FOLLOWED.every((key) => job[key] === undefined)
}

/**
 * The change that links a job to the global sync settings or cuts it loose.
 * Linking clears the fields, since an absent field is what follows. Cutting
 * loose writes the values the job runs with at that moment, so nothing about
 * it changes until somebody edits one.
 */
export function followPatch(on: boolean, defaults: Settings['defaults']): Partial<RawJob> {
  if (on) {
    return { direction: undefined, mode: undefined, schedule: undefined, emptyDirs: undefined, metadata: undefined }
  }
  const direction = (defaults?.direction as RawJob['direction']) || 'both'
  return {
    direction,
    // Written even for a two-way job, which would otherwise inherit a
    // default mirror or move and be refused, since those need a source side.
    mode: direction === 'both' ? 'sync' : (defaults?.mode as RawJob['mode']) || 'sync',
    schedule: defaults?.schedule ?? '',
    emptyDirs: defaults?.emptyDirs ?? false,
    metadata: defaults?.metadata ?? false,
  }
}
