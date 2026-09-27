// Shaped by what the helpers read rather than by the API types, so the phone,
// whose api.ts declares its own, can share them.
type Side = { job: string; side: string; total: number; bytes: number }

/** How much a set of sides holds between them. */
export function trashTotals(sides: Side[]): { entries: number; bytes: number } {
  let entries = 0
  let bytes = 0
  for (const s of sides) {
    entries += s.total
    bytes += s.bytes
  }
  return { entries, bytes }
}

/** Puts a fresh answer for one job, or for every job when job is empty, into the sides the page holds. */
export function mergeTrash<S extends Side>(held: S[] | null, job: string, fresh: S[]): S[] {
  return job ? [...(held ?? []).filter((s) => s.job !== job), ...fresh] : fresh
}

/**
 * The sides in the configuration's order of jobs, left before right. A job no
 * longer configured goes last rather than vanishing, until the next full answer.
 */
export function inJobOrder<S extends Side>(sides: S[], order: string[]): S[] {
  const rank = (name: string) => {
    const at = order.indexOf(name)
    return at === -1 ? order.length : at
  }
  return [...sides].sort((a, b) => rank(a.job) - rank(b.job) || a.job.localeCompare(b.job) || a.side.localeCompare(b.side))
}

/** The sides grouped by job, each job once, for sides already in job order. */
export function byJob<S extends Side>(sides: S[]): { job: string; sides: S[] }[] {
  const out: { job: string; sides: S[] }[] = []
  for (const s of sides) {
    const last = out[out.length - 1]
    if (last && last.job === s.job) last.sides.push(s)
    else out.push({ job: s.job, sides: [s] })
  }
  return out
}
