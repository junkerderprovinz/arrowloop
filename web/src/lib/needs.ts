// What waits for a person, counted in one place so the browser's job page and
// the phone's job screen can never disagree about it.

import type { Finding } from './anomalies'

export type HeadState = 'inSync' | 'withNotes' | 'needsYou'

export type Need =
  | { kind: 'conflicts'; count: number }
  | { kind: 'held'; job: string; finding: string }
  | { kind: 'notes'; count: number }
  | { kind: 'neverRan'; job: string }
  | { kind: 'failed'; job: string }

export type Needs = { head: HeadState; items: Need[] }

/** What a job's own state adds: whether it is switched on, has run, and whether its last run failed. */
export type JobState = { name: string; disabled: boolean; ran: boolean; failed: boolean }

/**
 * Open conflicts and held runs need an answer before anything moves on, so
 * either puts the head on "Needs you". Any other open finding is a note, and
 * so is an enabled job that has not run yet or whose last run failed: nothing
 * is in sync that never synced. A job a finding already speaks for gets no
 * second line.
 */
export function needs(openConflicts: number, openFindings: Finding[], jobs: JobState[]): Needs {
  const items: Need[] = []
  if (openConflicts > 0) items.push({ kind: 'conflicts', count: openConflicts })
  for (const f of openFindings) {
    if (f.held) items.push({ kind: 'held', job: f.job, finding: f.id })
  }
  const notes = openFindings.filter((f) => !f.held).length
  if (notes > 0) items.push({ kind: 'notes', count: notes })

  const spoken = new Set(openFindings.map((f) => f.job))
  for (const j of jobs) {
    if (j.disabled || spoken.has(j.name)) continue
    if (!j.ran) items.push({ kind: 'neverRan', job: j.name })
    else if (j.failed) items.push({ kind: 'failed', job: j.name })
  }

  const urgent = items.some((n) => n.kind === 'conflicts' || n.kind === 'held')
  const head: HeadState = urgent ? 'needsYou' : items.length > 0 ? 'withNotes' : 'inSync'
  return { head, items }
}
