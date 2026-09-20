import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// GlimStone rule 21: hover moves up the surface ramp. `--carbon-hover` is for
// an element with no fill of its own and sits below surface2, so on a filled
// element it darkens under the pointer. Surface2 hovers to surface3, surface3
// to hover-raised.
//
// Each string literal is checked on its own rather than each line, since a
// variant table puts different variants' fill and hover on adjacent lines. A
// class list split across two literals joined with `+` slips past.

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..')

/** Each resting fill, and the hover it is allowed to take (rule 21). */
const RAMP = [
  { filled: 'bg-carbon-surface2', hover: 'hover:bg-carbon-surface3' },
  { filled: 'bg-carbon-surface3', hover: 'hover:bg-carbon-hoverRaised' },
]
/**
 * The hover for something with no fill of its own, wrong on anything filled.
 * Anchored, because `hover:bg-carbon-hoverRaised` contains it.
 */
const WRONG = /hover:bg-carbon-hover(?![A-Za-z-])/

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

/** Every `file:line` where a filled element hovers to the tone below its own. */
function offenders(): string[] {
  const hits: string[] = []
  for (const path of sourceFiles(src)) {
    const text = readFileSync(path, 'utf8')
    for (const [piece, at] of classLists(text)) {
      if (!WRONG.test(piece)) continue
      const tier = RAMP.find((t) => piece.includes(t.filled))
      if (!tier) continue
      const line = text.slice(0, at).split('\n').length
      hits.push(`${path.slice(src.length + 1)}:${line} (${tier.hover})`)
    }
  }
  return hits.sort()
}

describe('hover ramp', () => {
  it('reads the source at all', () => {
    // An empty list would let the assertion below pass without checking anything.
    const files = sourceFiles(src)
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => readFileSync(f, 'utf8').includes(RAMP[0].filled))).toBe(true)
  })

  it('never hovers a filled element to the tone below its own', () => {
    // Each hit names the hover its tier should carry instead.
    expect(offenders(), `hovers below its own tone at: ${offenders().join(', ')}`).toEqual([])
  })
})
