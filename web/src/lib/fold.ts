/** Lowercases and drops accents and hyphens, so "zeitplane" finds "Zeitpläne" and "offsite" finds "Off-site". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/-/g, '').toLowerCase()
}

/** Whether every word of a query turns up in at least one of the names, folded alike. */
export function matchesQuery(query: string, names: string[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const said = names.map(fold)
  return words.every((w) => said.some((name) => name.includes(w)))
}
