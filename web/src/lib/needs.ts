// What waits for a person, counted in one place so the browser's job page and
// the phone's job screen can never disagree about it.

import type { Finding } from './anomalies'

export type HeadState = 'inSync' | 'withNotes' | 'needsYou'

export type Need =
  | { kind: 'conflicts'; count: number }
  | { kind: 'held'; job: string; finding: string }
  | { kind: 'notes'; count: number }

export type Needs = { head: HeadState; items: Need[] }

/**
 * Open conflicts and held runs need an answer before anything moves on, so
 * either puts the head on "Needs you". Any other open finding is a note: it
 * keeps the head off "In sync" without claiming the person has to act.
 */
export function needs(openConflicts: number, openFindings: Finding[]): Needs {
  const items: Need[] = []
  if (openConflicts > 0) items.push({ kind: 'conflicts', count: openConflicts })
  for (const f of openFindings) {
    if (f.held) items.push({ kind: 'held', job: f.job, finding: f.id })
  }
  const notes = openFindings.filter((f) => !f.held).length
  if (notes > 0) items.push({ kind: 'notes', count: notes })

  const urgent = items.some((n) => n.kind !== 'notes')
  const head: HeadState = urgent ? 'needsYou' : notes > 0 ? 'withNotes' : 'inSync'
  return { head, items }
}
