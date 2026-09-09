import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { glyphFor } from './glyphFor'

/**
 * Every button in the app can find a mark.
 *
 * This is the guard the glyph table never had, and its absence is exactly why
 * the same defect kept arriving as a report rather than as a red test. glyphFor
 * answers `undefined` for a key it does not recognise, and Button then falls
 * back to that button's TEXT. Nothing throws, nothing logs, and in the two
 * label modes that exist to show no words, one control in a row prints a word
 * while its neighbours print symbols. jdp found the last one by looking at it:
 * "der datentraeger anmelden button ist nicht in der beschriftungsengine."
 *
 * The fallback itself is right and stays: a word beats a symbol that means
 * nothing. What is wrong is reaching it by accident, which is what this checks.
 *
 * Deliberately NO allow-list of keys permitted to have no glyph. Every key in
 * the app resolves one today, so the honest assertion is "all of them", and an
 * exemption list is where this kind of guard quietly rots: an entry added to
 * make the suite green outlives the reason for it, and from outside a
 * documented exemption and a control that was forgotten look identical.
 */

/** Every .tsx under src, so a new page cannot escape by being new. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (name.endsWith('.tsx')) out.push(path)
  }
  return out
}

/**
 * The label keys a file passes, including both halves of a ternary.
 *
 * Read out of the SOURCE rather than by rendering the app, because rendering
 * only reaches the buttons a given state draws: the pause button and the resume
 * button are one call site with two keys, and only one of them exists on screen
 * at a time. A key that is only ever passed while a job is running would
 * otherwise never be looked at.
 */
function labelKeys(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(/labelKey=(?:"([^"]+)"|\{([^}]*)\})/g)) {
    if (m[1] !== undefined) {
      found.push(m[1])
      continue
    }
    // An expression: take every string literal in it. `null` is a real answer
    // here and carries no key, so it contributes nothing and is not a gap.
    for (const lit of (m[2] ?? '').matchAll(/'([^']+)'/g)) found.push(lit[1] as string)
  }
  return found
}

describe('the label engine reaches every button', () => {
  const files = sources(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

  it('finds label keys to check at all', () => {
    // Without this, a broken scanner would report perfect coverage of nothing.
    const all = files.flatMap((f) => labelKeys(readFileSync(f, 'utf8')))
    expect(all.length).toBeGreaterThan(30)
  })

  it('resolves a glyph for every key any button passes', () => {
    const missing: string[] = []
    for (const file of files) {
      for (const key of labelKeys(readFileSync(file, 'utf8'))) {
        if (glyphFor(key) === undefined) missing.push(`${key} (${file.split(/[\\/]/).pop()})`)
      }
    }
    expect(
      missing,
      `these buttons fall back to their text, so in glyph mode they print a word ` +
        `while their neighbours print symbols:\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })
})
