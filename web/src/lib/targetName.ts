/**
 * The most characters a target's name may have, as the engine counts them
 * (remotes.MaxLabel).
 */
export const TARGET_LABEL_MAX = 100

/**
 * The name to put in the field: the product's own, numbered rather than
 * refused when a target goes by it already, so a second account at one
 * service gets `OpenCloud 2`. The phone suggests names the same way, which is
 * why this lives in lib.
 */
export function suggestTargetName(product: string, taken: readonly string[]): string {
  const base = product.trim()
  if (!base) return ''
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; n < 100; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`
  return base
}
