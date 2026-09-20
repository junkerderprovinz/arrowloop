/**
 * A product's own name, folded into what a target name may hold.
 *
 * Capitals, digits, dots and hyphens stay as the product spells them. Only what
 * would split `name:path` in a job goes, the same characters the engine
 * refuses in `validName`. The phone suggests names from the same list, which is
 * why this lives in lib.
 */
export function targetName(product: string): string {
  return product
    .replace(/[:/\\,"'\s\t]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The name to put in the field, given what is already taken. Numbered rather
 * than refused, so a second account at one service gets `OpenCloud-2`.
 */
export function suggestTargetName(product: string, taken: readonly string[]): string {
  const base = targetName(product)
  if (!base) return ''
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; n < 100; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
  return base
}
