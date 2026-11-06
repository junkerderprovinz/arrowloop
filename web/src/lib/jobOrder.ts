// The order jobs stand in wherever they are listed. The engine hands out its
// job list in that order, alphabetical until somebody moves a job, so every
// other list takes its order from there. Shared with the phone, which imports
// it as it is.

/**
 * Compares job names by their place in `order`. A name the list does not
 * hold, such as a removed job that still has runs, goes after the others by
 * name.
 */
export function byJobOrder(order: readonly string[]): (a: string, b: string) => number {
  const place = new Map(order.map((name, at) => [name, at]))
  const at = (name: string) => place.get(name) ?? order.length
  return (a, b) => at(a) - at(b) || a.localeCompare(b)
}

/** Each job named once, in the order of the job list, as a filter offers them. */
export function jobNamesInOrder(names: Iterable<string>, order: readonly string[]): string[] {
  return [...new Set(names)].sort(byJobOrder(order))
}

/** The order with `name` moved one place towards the start or the end, as Alt and an arrow key move it. */
export function stepJob(order: readonly string[], name: string, by: -1 | 1): string[] {
  const from = order.indexOf(name)
  const to = from + by
  if (from < 0 || to < 0 || to >= order.length) return [...order]
  const next = [...order]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
