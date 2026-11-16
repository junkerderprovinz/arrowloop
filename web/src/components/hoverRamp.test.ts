import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// GlimStone rule 21: whatever the pointer is over takes `--hover`, the
// accent's tint at surface3's lightness, so a button, a row, a menu entry and
// a tile light up in one colour. A grey step from the surface ramp under the
// pointer would stand out next to the tinted ones.
//
// Each string literal is checked on its own rather than each line, since a
// variant table puts different variants' fill and hover on adjacent lines. A
// class list split across two literals joined with `+` slips past.

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..')

/** A hover to a grey step of the surface ramp. */
const GREY = /hover:bg-carbon-(?:hover|hoverRaised|surface\d)(?![A-Za-z0-9-])/

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) found.push(path)
  }
  return found
}

/** Plain quoted strings, and the static halves of template strings. */
const QUOTED = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g
const TEMPLATE = /`(?:[^`\\]|\\.)*`/g

/** Every piece of text that is one class list, with where it starts. */
function classLists(text: string): [string, number][] {
  const pieces: [string, number][] = []
  for (const found of text.matchAll(QUOTED)) pieces.push([found[0], found.index])
  for (const found of text.matchAll(TEMPLATE)) {
    // QUOTED already took the strings inside `${…}`; the static text around
    // them is a class list of its own.
    let at = found.index
    for (const chunk of found[0].split(/\$\{[\s\S]*?\}/)) {
      pieces.push([chunk, at])
      at += chunk.length
    }
  }
  return pieces
}

/** Every `file:line` where something hovers to a grey step. */
function offenders(): string[] {
  const hits: string[] = []
  for (const path of sourceFiles(src)) {
    const text = readFileSync(path, 'utf8')
    for (const [piece, at] of classLists(text)) {
      const grey = piece.match(GREY)
      if (!grey) continue
      const line = text.slice(0, at).split('\n').length
      hits.push(`${path.slice(src.length + 1)}:${line} (${grey[0]})`)
    }
  }
  return [...new Set(hits)].sort()
}

describe('hover colour', () => {
  it('reads the source at all', () => {
    // An empty list would let the assertion below pass without checking anything.
    const files = sourceFiles(src)
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => readFileSync(f, 'utf8').includes('hover:bg-hover'))).toBe(true)
  })

  it('lights everything under the pointer in the accent hover', () => {
    expect(offenders(), `grey hover at: ${offenders().join(', ')}`).toEqual([])
  })
})
