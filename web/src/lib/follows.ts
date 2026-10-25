import { describeCadence, readCadence } from './cadence'
import type { Translate, TranslationKey } from './i18n.data'

/**
 * The fields of a job that the global sync settings fill in, the ones
 * `applyTo` in internal/job/job.go reads. Shared with the phone, whose job type
 * spells direction and mode as plain strings.
 */
export interface InheritingJob {
  direction?: string
  mode?: string
  schedule?: string
  watch?: boolean
  watchSettle?: string
  quietPeriod?: string
  transfers?: number
  modWindow?: string
  emptyDirs?: boolean
  metadata?: boolean
  foldCase?: boolean
  brakePercent?: number
  changePercent?: number
  brakeFloor?: number
}

export type Defaults = Omit<InheritingJob, 'watch' | 'watchSettle'>

/** A setting a job takes from the defaults until it is given a value of its own. */
export type Inherited =
  | 'direction'
  | 'schedule'
  | 'quietPeriod'
  | 'transfers'
  | 'modWindow'
  | 'emptyDirs'
  | 'metadata'
  | 'foldCase'
  | 'brakePercent'
  | 'changePercent'
  | 'brakeFloor'

/** The settings on the Sync tile, in the order they stand there. */
export const SYNC_SETTINGS: Inherited[] = [
  'direction',
  'schedule',
  'transfers',
  'quietPeriod',
  'modWindow',
  'emptyDirs',
  'metadata',
  'foldCase',
]

/** The brakes, which stand on the Safety net tile. */
export const BRAKE_SETTINGS: Inherited[] = ['brakePercent', 'changePercent', 'brakeFloor']

export const SETTING_LABEL: Record<Inherited, TranslationKey> = {
  direction: 'direction.label',
  schedule: 'edit.schedule',
  quietPeriod: 'edit.quietPeriod',
  transfers: 'engine.transfers',
  modWindow: 'engine.modWindow',
  emptyDirs: 'edit.emptyDirs',
  metadata: 'edit.metadata',
  foldCase: 'engine.foldCase',
  brakePercent: 'engine.brakePercent',
  changePercent: 'engine.changePercent',
  brakeFloor: 'engine.brakeFloor',
}

/**
 * Whether the job holds a value of its own for the setting. An empty string
 * and a zero count as absent where the loader treats them so, with one
 * exception: an empty schedule is a job that runs only when asked. A watching
 * job's schedule is its own, since the default cannot watch.
 */
export function owns(job: InheritingJob, setting: Inherited): boolean {
  switch (setting) {
    case 'direction':
      return !!job.direction || !!job.mode
    case 'schedule':
      return job.schedule !== undefined || job.watch === true
    case 'quietPeriod':
    case 'modWindow':
      return !!job[setting]
    case 'transfers':
      return (job.transfers ?? 0) > 0
    default:
      return job[setting] !== undefined
  }
}

/**
 * The change that gives a setting back to the defaults. An absent field is
 * what follows, so it clears every field the setting writes.
 */
export function inheritPatch(setting: Inherited): Partial<InheritingJob> {
  switch (setting) {
    case 'direction':
      return { direction: undefined, mode: undefined }
    case 'schedule':
      return { schedule: undefined, watch: undefined, watchSettle: undefined }
    default:
      return { [setting]: undefined }
  }
}

/** The engine's own values, for a default nobody has set. See plan.DefaultOptions. */
const BUILT_IN = {
  quietPeriod: '5s',
  transfers: 4,
  modWindow: '2s',
  brakePercent: 50,
  changePercent: 50,
  brakeFloor: 10,
}

/**
 * The value a job that follows the defaults runs with. Override writes it as
 * the job's own, so nothing about the job changes until somebody edits it. A
 * two-way job gets `sync`, since an unset mode would take a default mirror,
 * which the engine refuses for a job that runs both ways.
 */
export function inForce(defaults: Defaults | undefined, setting: Inherited): InheritingJob {
  const d = defaults ?? {}
  switch (setting) {
    case 'direction': {
      const direction = d.direction || 'both'
      return { direction, mode: direction === 'both' ? 'sync' : d.mode || 'sync' }
    }
    case 'schedule':
      return { schedule: d.schedule ?? '' }
    case 'emptyDirs':
    case 'metadata':
      return { [setting]: d[setting] ?? false }
    case 'foldCase':
      return { foldCase: d.foldCase }
    case 'quietPeriod':
    case 'modWindow':
      return { [setting]: d[setting] || BUILT_IN[setting] }
    default:
      return { [setting]: d[setting] ?? BUILT_IN[setting] }
  }
}

/** One setting's value in words, as the job holds it or as the defaults give it. */
export function describeValue(job: InheritingJob, setting: Inherited, t: Translate): string {
  switch (setting) {
    case 'direction': {
      const direction = job.direction || 'both'
      const way = t(
        direction === 'leftToRight' ? 'direction.toRight' : direction === 'rightToLeft' ? 'direction.toLeft' : 'direction.both',
      )
      if (direction === 'both') return way
      const mode = job.mode === 'mirror' || job.mode === 'move' ? job.mode : 'sync'
      return `${way}, ${t(`mode.${mode}`)}`
    }
    case 'schedule':
      return describeCadence(readCadence(job.schedule ?? '', !!job.watch), t)
    case 'quietPeriod':
    case 'modWindow':
      // As the file and the engine spell it, "30s", which reads the same in
      // every language.
      return job[setting]?.trim() || '0s'
    case 'emptyDirs':
    case 'metadata':
      return t(job[setting] ? 'defaults.on' : 'defaults.off')
    case 'foldCase':
      return t(job.foldCase === undefined ? 'engine.foldAuto' : job.foldCase ? 'engine.foldOn' : 'engine.foldOff')
    case 'brakePercent':
    case 'changePercent':
      return `${job[setting] ?? 0} %`
    default:
      return String(job[setting] ?? 0)
  }
}

/** "Schedule: daily at 03:00", the way a list of what differs names one setting. */
export function describeOwn(job: InheritingJob, setting: Inherited, t: Translate): string {
  return `${t(SETTING_LABEL[setting])}: ${describeValue(job, setting, t)}`
}

/** A job that differs from the defaults, and in which settings. */
export interface Exception {
  name: string
  own: Inherited[]
}

/** The jobs that hold a value of their own for any of `settings`, in list order. */
export function exceptionsOf(jobs: (InheritingJob & { name?: string })[], settings: Inherited[]): Exception[] {
  const out: Exception[] = []
  for (const job of jobs) {
    const own = settings.filter((s) => owns(job, s))
    if (own.length > 0 && job.name) out.push({ name: job.name, own })
  }
  return out
}

export function inheritAll(settings: Inherited[]): Partial<InheritingJob> {
  return Object.assign({}, ...settings.map(inheritPatch)) as Partial<InheritingJob>
}

/** The settings the job window shows, which its one switch hands to the defaults or takes back. */
export const JOB_WINDOW_SETTINGS: Inherited[] = ['direction', 'schedule', 'quietPeriod', 'emptyDirs', 'metadata']

/** Whether the job holds none of `settings` itself, so all of them come from the defaults. */
export function followsAll(job: InheritingJob, settings: Inherited[]): boolean {
  return !settings.some((s) => owns(job, s))
}

/**
 * The change that writes the value in force for every one of `settings` as the
 * job's own, so the fields stay as they were and can be edited from there.
 */
export function overrideAll(defaults: Defaults | undefined, settings: Inherited[]): Partial<InheritingJob> {
  return Object.assign({}, ...settings.map((s) => inForce(defaults, s))) as Partial<InheritingJob>
}
