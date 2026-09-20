import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { glyphFor } from './glyphFor'

/**
 * Every button in the app can find a mark.
 *
 * glyphFor answers `undefined` for a key it does not know and Button falls back
 * to the text, silently, so in the glyph-only label modes one control prints a
 * word among symbols. There is no allow-list: every key resolves a glyph, and an
 * exemption would look the same as a forgotten control.
 */

/** Every .tsx under src, so a new page is covered. */
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
 * The label keys a file passes, including both halves of a ternary. Read from
 * the source, because rendering only reaches the keys the current state draws.
 */
function labelKeys(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(/labelKey=(?:"([^"]+)"|\{([^}]*)\})/g)) {
    if (m[1] !== undefined) {
      found.push(m[1])
      continue
    }
    // An expression: take every string literal in it. `null` carries no key.
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
