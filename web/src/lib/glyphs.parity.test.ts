import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BRANDS, COINS, DONATE_GLYPHS, GLYPHS } from './glyphs.data'

/**
 * The data file against the components it was generated from.
 *
 * Regenerating the icons without re-running scripts/gen_glyph_data.py leaves
 * the phone with an old mark or none, and both apps still build. The check
 * compares names, since a gap is what a forgotten command produces.
 */

function component(file: string): string {
  return readFileSync(join(__dirname, '..', 'components', file), 'utf8')
}

function exported(file: string): string[] {
  return [...component(file).matchAll(/^export function (Icon\w+)\(/gm)].map((m) => m[1]!).sort()
}

/** The coin ids in donateMarks.tsx's COINS map, which are map keys rather than
 *  exported functions. */
function coins(): string[] {
  const source = component('donateMarks.tsx')
  const map = source.slice(source.indexOf('const COINS: Record<string, ReactNode> = {'))
  return [...map.slice(0, map.indexOf('\n};')).matchAll(/^ {2}(\w+): \(/gm)].map((m) => m[1]!).sort()
}

describe.each([
  ['glyphs.tsx', GLYPHS, 'GLYPHS'],
  ['brandGlyphs.tsx', BRANDS, 'BRANDS'],
] as const)('%s', (file, table, name) => {
  it(`has the same marks as ${name} in glyphs.data.ts`, () => {
    const components = exported(file)
    const data = Object.keys(table).sort()
    expect(components.length).toBeGreaterThan(20)
    expect(
      {
        missing: components.filter((n) => !data.includes(n)),
        extra: data.filter((n) => !components.includes(n)),
      },
      `${file} and glyphs.data.ts disagree - re-run scripts/gen_glyph_data.py`,
    ).toEqual({ missing: [], extra: [] })
  })
})

describe('donateMarks.tsx', () => {
  it('has the marks the give buttons wear', () => {
    // The crypto button wears Bitcoin's letter without the coin's disc.
    expect(Object.keys(DONATE_GLYPHS).sort()).toEqual(['IconBitcoin', 'IconBuyMeACoffee', 'IconPayPal'])
    for (const [name, glyph] of Object.entries(DONATE_GLYPHS)) {
      expect(glyph.box, name).toMatch(/^[\d. -]+$/)
      expect(glyph.groups.flatMap((g) => g.parts).length, name).toBeGreaterThan(0)
    }
  })

  it('has the same coins as COINS in glyphs.data.ts', () => {
    const source = coins()
    const data = Object.keys(COINS).sort()
    expect(source.length).toBeGreaterThan(5)
    expect(
      {
        missing: source.filter((n) => !data.includes(n)),
        extra: data.filter((n) => !source.includes(n)),
      },
      'donateMarks.tsx and glyphs.data.ts disagree - re-run scripts/gen_glyph_data.py',
    ).toEqual({ missing: [], extra: [] })
  })
})

/** The drawings carried as whole markup strings rather than parsed. Brand names
 *  are `IconX` and coin ids are lowercase tickers, so the spread overwrites nothing. */
const WHOLE = { ...BRANDS, ...COINS }

describe('the drawings survived the lift', () => {
  it('gives every app glyph a box and at least one part', () => {
    for (const [name, glyph] of Object.entries(GLYPHS)) {
      expect(glyph.box, name).toMatch(/^[\d. -]+$/)
      const parts = glyph.groups.flatMap((g) => g.parts)
      expect(parts.length, name).toBeGreaterThan(0)
      for (const part of parts) {
        // A part that is neither a path nor a rectangle was dropped by the extractor.
        expect(Boolean(part.d) || Boolean(part.rect), `${name} has an empty part`).toBe(true)
      }
    }
  })

  it('gives every brand mark and coin a box and some markup', () => {
    for (const [name, brand] of Object.entries(WHOLE)) {
      expect(brand.box, name).toMatch(/^[\d. -]+$/)
      expect(brand.svg.length, name).toBeGreaterThan(20)
    }
  })

  it('leaves no JSX in a mark carried whole', () => {
    // An SVG parser does not understand `style={{ ... }}` and draws a blank
    // mark without logging anything. The hand-written coins can also carry a
    // `{/* */}` comment, which is an expression rather than markup.
    for (const [name, brand] of Object.entries(WHOLE)) {
      expect(brand.svg, `${name} still carries JSX`).not.toMatch(/\w+=\{/)
      expect(brand.svg, `${name} still carries a JSX comment`).not.toContain('{/*')
    }
  })

  it('leaves no colour a stylesheet has to resolve', () => {
    // react-native-svg cannot resolve `var(--x)` and draws the shape invisible,
    // so colours travel as `{{name}}` and are filled in when the theme is known.
    for (const [name, brand] of Object.entries(WHOLE)) {
      expect(brand.svg, `${name} still carries a CSS colour`).not.toMatch(/var\(/)
      for (const slot of brand.svg.matchAll(/\{\{([^}]+)\}\}/g)) {
        expect(Object.keys(brand.vars), `${name} has no answer for ${slot[1]}`).toContain(slot[1]!)
      }
    }
  })

  it('keeps the marks that need a second colour on a dark page', () => {
    // A count rather than names, so the stylesheet may gain more. Zero means the
    // generator misread `:not([data-theme="dark"])` as the dark block.
    const swapped = Object.values(BRANDS).filter(
      (b) => b.fill !== null && typeof b.fill === 'object' && b.fill.light !== b.fill.dark,
    )
    expect(swapped.length).toBeGreaterThan(5)
  })
})
