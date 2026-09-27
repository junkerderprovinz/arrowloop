// Shaped by what the helpers read rather than by the API types, so the phone,
// whose api.ts declares its own, can share them.

type Named = { job: string; copy: string }
type Dated = Named & { plain: string; at: string; left: { mod: string }; right: { mod: string } }
type Listing<C> = { conflicts: C[]; unread: { job: string; error: string }[] }

/** Names one conflict across jobs, since two jobs can set aside the same path. */
export function conflictKey(c: Named): string {
  return `${c.job}\n${c.copy}`
}

/** The side holding the newer version, or null when both carry the same time. */
export function newerSide(c: Dated): 'left' | 'right' | null {
  const left = Date.parse(c.left.mod)
  const right = Date.parse(c.right.mod)
  if (left === right) return null
  return left > right ? 'left' : 'right'
}

/**
 * Groups one choice for many conflicts into one request per job, since a job
 * decides its own conflicts in a single run.
 */
export function decisionsByJob<K extends string>(chosen: Named[], keep: K): Map<string, { copy: string; keep: K }[]> {
  const out = new Map<string, { copy: string; keep: K }[]>()
  for (const c of chosen) {
    const list = out.get(c.job) ?? []
    list.push({ copy: c.copy, keep })
    out.set(c.job, list)
  }
  return out
}

/** Oldest first, then by job and path, the order the engine answers in. */
function inOrder(a: Dated, b: Dated): number {
  return Date.parse(a.at) - Date.parse(b.at) || a.job.localeCompare(b.job) || a.plain.localeCompare(b.plain)
}

/**
 * Puts a fresh answer for one job, or for all of them when job is empty, into
 * the listing the page holds, oldest conflict first as the engine sends them.
 */
export function mergeConflicts<C extends Dated>(held: Listing<C> | null, job: string, fresh: Listing<C>): Listing<C> {
  if (!job || !held) return fresh
  return {
    conflicts: [...held.conflicts.filter((c) => c.job !== job), ...fresh.conflicts].sort(inOrder),
    unread: [...held.unread.filter((u) => u.job !== job), ...fresh.unread],
  }
}

/** Drops selections whose conflict is no longer listed. */
export function stillListed(selected: Set<string>, listed: Named[]): Set<string> {
  const live = new Set(listed.map(conflictKey))
  const out = new Set([...selected].filter((k) => live.has(k)))
  return out.size === selected.size ? selected : out
}
