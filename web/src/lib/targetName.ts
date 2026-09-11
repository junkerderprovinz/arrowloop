/**
 * A product's own name, folded into what a target name may hold.
 *
 * It used to lowercase everything, so picking OpenCloud suggested `opencloud`
 * and Google Drive suggested `google-drive`. jdp: "Kann man den Namen nicht
 * ordentlich schreiben z.B OpenCloud anstatt opencloud im Namensfeld." He is
 * right, and the lowercasing was never buying anything: rclone accepts capitals
 * in a remote name perfectly well. What it DID buy was a name that no longer
 * looks like the thing it points at, in the one field a person reads back later
 * to work out which target is which.
 *
 * What actually has to go is only what would change the MEANING of the name.
 * A target is written as `name:path` in a job, so a colon, a slash or a space
 * would split it somewhere nobody intended; the engine refuses those in
 * `validName` and this refuses them here, before anybody can type them in and
 * be told no. Everything else - capitals, digits, dots, hyphens - survives
 * exactly as the product spells it.
 *
 * It lives in `lib` rather than in the page that first needed it because the
 * PHONE suggests the same name from the same list of products, and a rule that
 * exists twice is a rule that agrees until the day somebody fixes one of them.
 * Metro cannot read a file that returns `<div>`, which is the whole reason the
 * translations, the schedule reader and the glyphs made this move already.
 */
export function targetName(product: string): string {
  return product
    .replace(/[:/\\,"'\s\t]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The name to put in the field, given what is already taken.
 *
 * Numbered rather than refused: pressing OpenCloud twice gives `OpenCloud` and
 * `OpenCloud-2`, which is what somebody setting up two accounts at one service
 * is doing, rather than a collision reported on save after the password has
 * been typed.
 */
export function suggestTargetName(product: string, taken: readonly string[]): string {
  const base = targetName(product)
  if (!base) return ''
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; n < 100; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
  return base
}
