// How a job picks the shared lists it includes and excludes. Shaped by what it
// reads rather than by the API types, so the phone can share it.

export type SetChoice = { includeSets?: string[]; excludeSets?: string[] }

export type Way = 'include' | 'exclude'

/**
 * Picks a shared list on one side of a job, or drops it. A list sits on one
 * side at most, since a list both included and excluded takes nothing it
 * matches. A side left without lists is undefined, so a job that never
 * included a list does not gain a key an older engine refuses.
 */
export function pickSet(job: SetChoice, name: string, way: Way, on: boolean): SetChoice {
  const without = (list: string[] | undefined) => {
    const left = (list ?? []).filter((each) => each !== name)
    return left.length > 0 ? left : undefined
  }
  const mine = way === 'include' ? job.includeSets : job.excludeSets
  const other = way === 'include' ? job.excludeSets : job.includeSets
  const picked = on ? [...(without(mine) ?? []), name] : without(mine)
  const rest = on ? without(other) : other
  return way === 'include' ? { includeSets: picked, excludeSets: rest } : { includeSets: rest, excludeSets: picked }
}

/** The lists one side may pick: all of them but those the other side has. */
export function offered(available: string[], job: SetChoice, way: Way): string[] {
  const other = (way === 'include' ? job.excludeSets : job.includeSets) ?? []
  return available.filter((name) => !other.includes(name))
}

/** Writes one side's whole pick, and takes what it picked off the other side. */
export function setSide(job: SetChoice, way: Way, picked: string[]): SetChoice {
  const other = ((way === 'include' ? job.excludeSets : job.includeSets) ?? []).filter((name) => !picked.includes(name))
  const mine = picked.length > 0 ? picked : undefined
  const rest = other.length > 0 ? other : undefined
  return way === 'include' ? { includeSets: mine, excludeSets: rest } : { includeSets: rest, excludeSets: mine }
}

/**
 * Whether a job takes no files because every list it includes is empty and it
 * has no inclusions of its own. The engine then takes nothing rather than
 * every file, and the job says so.
 */
export function takesNothing(job: { include?: string[]; includeSets?: string[] }, emptySets: string[]): boolean {
  const lists = job.includeSets ?? []
  if (lists.length === 0) return false
  if ((job.include ?? []).length > 0) return false
  return lists.every((name) => emptySets.includes(name))
}

/**
 * The lists with a new, empty one added, or null for a blank name or one
 * already taken, which would empty the list of that name.
 */
export function addList(sets: Record<string, string[]>, typed: string): Record<string, string[]> | null {
  const name = typed.trim()
  if (!name || name in sets) return null
  return { ...sets, [name]: [] }
}

type Named = SetChoice & { name: string }

/**
 * How many jobs a shared list reaches, which is how many an edit to it
 * changes. The job being edited counts by what it picks now, saved or not.
 */
export function jobsUsing(jobs: Named[], list: string, editing?: Named): number {
  const uses = (j: SetChoice) => (j.includeSets ?? []).includes(list) || (j.excludeSets ?? []).includes(list)
  const others = jobs.filter((j) => j.name !== editing?.name && uses(j)).length
  return others + (editing && uses(editing) ? 1 : 0)
}

type Patterns = SetChoice & { include?: string[]; exclude?: string[] }

/**
 * The jobs with a list taken out of both sides, each keeping its patterns as
 * its own. Dropping the name alone would widen a job that included only this
 * list to every file.
 */
export function handOver<J extends Patterns>(jobs: J[], list: string, patterns: string[]): J[] {
  const rest = (sets: string[]) => {
    const left = sets.filter((name) => name !== list)
    return left.length > 0 ? left : undefined
  }
  const merged = (own: string[] | undefined) => [...(own ?? []), ...patterns.filter((p) => !(own ?? []).includes(p))]
  return jobs.map((j) => {
    const next = { ...j }
    if (j.includeSets?.includes(list)) {
      next.include = merged(j.include)
      next.includeSets = rest(j.includeSets)
    }
    if (j.excludeSets?.includes(list)) {
      next.exclude = merged(j.exclude)
      next.excludeSets = rest(j.excludeSets)
    }
    return next
  })
}

/**
 * The jobs that would take every file once the list goes: they include it,
 * it is empty, and nothing else gives them a pattern to include.
 */
export function stranded(jobs: (Patterns & { name: string })[], list: string, patterns: string[]): string[] {
  if (patterns.length > 0) return []
  return jobs
    .filter((j) => j.includeSets?.includes(list) && (j.include ?? []).length === 0 && j.includeSets.every((name) => name === list))
    .map((j) => j.name)
}
