import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GlimStone rule 21: hover moves UP the surface ramp.
 *
 * `--carbon-hover` (#353535) is the hover fill for something carrying no fill
 * of its own. It sits BELOW `--carbon-surface2` (#393939), so putting it on an
 * element that is already filled with surface2 makes that element four units
 * DARKER under the pointer - it dims at the one moment somebody is looking
 * straight at it, which reads as no hover at all. Anything already filled with
 * surface2 hovers to `--carbon-surface3` (#525252) instead.
 *
 * A test rather than a note, because the note existed: GlimStone's token table
 * has said "hover on surface2" beside `--carbon-surface3` since the beginning,
 * and thirteen places across three apps still got it wrong. Prose that has
 * already failed to stop a mistake does not stop it by being repeated.
 *
 * KNOWN LIMIT: this reads two lines at a time, so a class list broken across
 * three or more lines - or split between two string literals and joined with
 * `+` - can carry the pair past it. That catches every way these classes are
 * actually written here today and none of the ways they are not.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..')

const FILLED = 'bg-carbon-surface2'
const WRONG = 'hover:bg-carbon-hover'

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) found.push(path)
  }
  return found
}

/** Every `file:line` where a surface2-filled element hovers to the wrong tone. */
function offenders(): string[] {
  const hits: string[] = []
  for (const path of sourceFiles(src)) {
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!line.includes(WRONG)) return
      const window = (lines[i - 1] ?? '') + line
      if (window.includes(FILLED)) hits.push(`${path.slice(src.length + 1)}:${i + 1}`)
    })
  }
  return hits
}

describe('hover ramp', () => {
  it('reads the source at all', () => {
    // Guards the guard: a rename that empties this list would make the
    // assertion below pass forever while checking nothing.
    const files = sourceFiles(src)
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => readFileSync(f, 'utf8').includes(FILLED))).toBe(true)
  })

  it('never hovers a filled element to the tone below its own', () => {
    expect(offenders(), `use hover:bg-carbon-surface3 at: ${offenders().join(', ')}`).toEqual([])
  })
})
