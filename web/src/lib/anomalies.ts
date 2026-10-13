// What a finding says, shared by the browser and the phone: its place in the
// order, its sentences and its figures. Each surface draws them its own way.

import type { Failure } from './failure'
import type { TranslationKey } from './i18n.data'

export type AnomalyKind = 'delete' | 'change' | 'empty' | 'failing' | 'overdue' | 'unusual'
export type Severity = 'critical' | 'warning' | 'info'
export type Outcome = 'ran' | 'takenBack' | 'acknowledged' | 'resolved'

/** One thing the engine found about one job; see internal/anomaly. */
export type Finding = {
  id: string
  job: string
  kind: AnomalyKind
  severity: Severity
  /** A brake's finding holds its job until somebody answers it. */
  held: boolean
  since: string
  seen: string
  /** Files a brake counted, failed runs in a row, or days without a run. */
  count?: number
  known?: number
  limit?: number
  onLeft?: number
  onRight?: number
  /** The side that lists nothing. */
  side?: 'left' | 'right'
  paths?: string[]
  /** What an unusual run did that its job usually does not. */
  figures?: Measure[]
  /** The engine's own English words: the refusal, or the last failure. */
  detail?: string
  /** What kind of failure `detail` names, where the engine knows. */
  failure?: Failure
  open: boolean
  outcome?: Outcome
  closed?: string
}

export type FindingListing = { open: Finding[]; closed: Finding[] }

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

export const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

/** One thing measured about a run; a duration is in seconds. */
export type Figure = 'deleted' | 'copied' | 'duration'

/** A figure of one run that left its usual range. */
export type Measure = { figure: Figure; value: number; low: number; high: number }

/** How far the engine has learned one job's runs, with the usual ranges once it has. */
export type JobLearning = { job: string; runs: number; usual?: { figure: Figure; low: number; high: number }[] }

/** How many successful runs a job needs before its runs are judged; see internal/anomaly. */
export const LEARN_AFTER = 10

/** A figure's value as a reader takes it: a count of files as it is, a time in seconds, minutes or hours. */
export function amount(figure: Figure, n: number, t: Translate): string {
  if (figure !== 'duration') return String(n)
  if (n < 120) return t('anomaly.unit.seconds', { count: n })
  if (n < 2 * 3600) return t('anomaly.unit.minutes', { count: Math.round(n / 60) })
  return t('anomaly.unit.hours', { count: Math.round(n / 360) / 10 })
}

/** An unusual run's figures, one sentence each. */
function unusual(f: Finding, t: Translate): string[] {
  return (f.figures ?? []).map((m) =>
    t(`anomaly.say.unusual.${m.figure}`, {
      value: amount(m.figure, m.value, t),
      low: amount(m.figure, m.low, t),
      high: amount(m.figure, m.high, t),
    }),
  )
}

/** One job's open findings, loudest first, with the loudest of them named. */
export type FindingGroup = { job: string; worst: Severity; findings: Finding[] }

/** Groups findings by job, the job in most trouble first. */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  const rank = (s: Severity) => SEVERITIES.indexOf(s)
  const byJob = new Map<string, Finding[]>()
  for (const f of findings) byJob.set(f.job, [...(byJob.get(f.job) ?? []), f])
  return [...byJob.entries()]
    .map(([job, list]) => {
      const sorted = [...list].sort((a, b) => rank(a.severity) - rank(b.severity))
      return { job, worst: sorted[0]?.severity ?? 'info', findings: sorted }
    })
    .sort((a, b) => rank(a.worst) - rank(b.worst) || a.job.localeCompare(b.job))
}

/** How many open findings each severity has. */
export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const f of findings) out[f.severity] += 1
  return out
}

/** The share a brake measured, in whole percent as the engine compares it. */
export function share(f: Finding): number {
  return Math.floor(((f.count ?? 0) * 100) / Math.max(f.known ?? 0, 1))
}

/**
 * The side a brake's change was made on and the side it would land on, when
 * all of it runs one way. A two-way job can hold deletions in both directions,
 * and then neither side is the one to name.
 */
export function direction(f: Finding): { from: 'left' | 'right'; to: 'left' | 'right' } | null {
  if ((f.onLeft ?? 0) > 0 && (f.onRight ?? 0) > 0) return null
  if ((f.onRight ?? 0) > 0) return { from: 'left', to: 'right' }
  if ((f.onLeft ?? 0) > 0) return { from: 'right', to: 'left' }
  return null
}

/** What a finding's line says beside its kind. */
export function shortLine(f: Finding, t: Translate, places: [string, string]): string {
  switch (f.kind) {
    case 'delete':
    case 'change':
      return t('anomaly.short.files', { count: f.count ?? 0, known: f.known ?? 0 })
    case 'empty':
      return places[f.side === 'right' ? 1 : 0]
    case 'failing':
      return t('anomaly.short.failing', { count: f.count ?? 0 })
    case 'unusual':
      return unusual(f, t)[0] ?? ''
    default:
      return t('anomaly.short.overdue', { count: f.count ?? 0 })
  }
}

/** The whole sentence, and for a brake where the change was made and where it would land. */
export function sentence(f: Finding, t: Translate, places: [string, string]): string {
  const name = (side: 'left' | 'right') => places[side === 'right' ? 1 : 0]
  switch (f.kind) {
    case 'delete':
    case 'change': {
      const said = t(`anomaly.say.${f.kind}`, {
        count: f.count ?? 0,
        known: f.known ?? 0,
        percent: share(f),
        limit: f.limit ?? 0,
      })
      const way = direction(f)
      return way ? `${said} ${t(`anomaly.where.${f.kind}`, { from: name(way.from), to: name(way.to) })}` : said
    }
    case 'empty':
      return t('anomaly.say.empty', { place: name(f.side ?? 'left'), known: f.known ?? 0 })
    case 'failing':
      return t('anomaly.say.failing', { count: f.count ?? 0 })
    case 'unusual':
      return unusual(f, t).join(' ')
    default:
      return t('anomaly.say.overdue', { count: f.count ?? 0 })
  }
}

/** The numbers a brake measured, as label and value. The two notes carry theirs in the sentence. */
export function figures(f: Finding, t: Translate): [string, string][] {
  const n = (v: number | undefined) => String(v ?? 0)
  switch (f.kind) {
    case 'delete':
    case 'change':
      return [
        [t(`anomaly.fig.${f.kind}`), n(f.count)],
        [t('anomaly.fig.known'), n(f.known)],
        [t('anomaly.fig.share'), `${share(f)} %`],
        [t('anomaly.fig.limit'), `${n(f.limit)} %`],
      ]
    case 'empty':
      return [
        [t('anomaly.fig.listed'), '0'],
        [t('anomaly.fig.known'), n(f.known)],
      ]
    default:
      return []
  }
}

/**
 * The answer a held job's card leads with. Taking back is the safe one where
 * files were rewritten or a side emptied; a mass deletion is usually meant.
 */
export function leadingAnswer(f: Finding): 'run' | 'restore' {
  return f.severity === 'critical' ? 'restore' : 'run'
}

export type Brakes = { brakePercent: number; changePercent: number; brakeFloor: number }

/** The brakes every job follows that sets none of its own, with the engine's values where the file is silent. */
export function globalBrakes(defaults: Partial<Brakes> | undefined): Brakes {
  return {
    brakePercent: defaults?.brakePercent ?? 50,
    changePercent: defaults?.changePercent ?? 50,
    brakeFloor: defaults?.brakeFloor ?? 10,
  }
}

/** The job's own two brakes as its configuration states them, or null while it follows the global ones. */
export function ownBrakes(
  job: { brakePercent?: number; changePercent?: number } | undefined,
  global: Brakes,
): Pick<Brakes, 'brakePercent' | 'changePercent'> | null {
  if (job?.brakePercent === undefined && job?.changePercent === undefined) return null
  return {
    brakePercent: job.brakePercent ?? global.brakePercent,
    changePercent: job.changePercent ?? global.changePercent,
  }
}
