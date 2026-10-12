import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BRANDS, DONATE_GLYPHS, GLYPHS } from './glyphs.data'

/**
 * Glyph names that travel as strings, checked against the drawings.
 *
 * The rule table and the phone name a glyph by string, so a renamed or dropped
 * glyph passes the compiler and the button quietly shows its word, or nothing.
 */

const ROOT = join(__dirname, '..', '..', '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

function quotedNames(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/["'](Icon[A-Z]\w*)["']/g)].map((m) => m[1]!)
}

const DRAWN = new Set([...Object.keys(GLYPHS), ...Object.keys(BRANDS), ...Object.keys(DONATE_GLYPHS)])

describe('glyph names given as strings', () => {
  it('name a glyph the rule table can draw', () => {
    const names = quotedNames(join(ROOT, 'web', 'src', 'lib', 'glyphName.ts'))
    expect(names.length).toBeGreaterThan(20)
    expect(names.filter((n) => !(n in GLYPHS))).toEqual([])
  })

  it('name a glyph the phone can draw', () => {
    const files = [...walk(join(ROOT, 'mobile', 'src')), join(ROOT, 'mobile', 'App.tsx')]
    const missing = files.flatMap((f) =>
      quotedNames(f)
        .filter((n) => !DRAWN.has(n))
        .map((n) => `${n} (${f.split(/[\\/]/).pop()})`),
    )
    expect(missing).toEqual([])
  })

  it('give every glyph from the assortment the viewBox glyphs.json measured', () => {
    const assortment: { name: string; viewBox: string }[] = JSON.parse(
      readFileSync(join(ROOT, 'scripts', 'glyphs.json'), 'utf8'),
    )
    const stale = assortment
      .filter((e) => e.name in GLYPHS && GLYPHS[e.name]!.box !== e.viewBox)
      .map((e) => e.name)
    expect(stale, 'glyphs.json changed without a rerun of scripts/gen_glyphs.py').toEqual([])
  })
})

describe('the preview glyph', () => {
  it('is a drawing of its own, not the eye that shows a secret', () => {
    expect(JSON.stringify(GLYPHS.IconPreview)).not.toEqual(JSON.stringify(GLYPHS.IconEye))
  })
})
