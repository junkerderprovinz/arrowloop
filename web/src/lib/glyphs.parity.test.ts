import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BRANDS, GLYPHS } from './glyphs.data'

/**
 * The data file against the components it was lifted from.
 *
 * `glyphs.data.ts` is generated from the two generated component files, which
 * makes it the third link in a chain and therefore the one that goes stale
 * silently: regenerating the icons and forgetting the second command leaves the
 * browser with a new mark and the phone with the old one, or with none. Nothing
 * else can see that - both files compile, both apps build, and the only symptom
 * is a button on a phone wearing no icon.
 *
 * It compares NAMES rather than drawings. A path that changed shape is a
 * redraw and shows up in review; a name that exists on one side and not the
 * other is a gap, and a gap is what a forgotten command produces.
 */

function exported(file: string): string[] {
  const source = readFileSync(join(__dirname, '..', 'components', file), 'utf8')
  return [...source.matchAll(/^export function (Icon\w+)\(/gm)].map((m) => m[1]!).sort()
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

describe('the drawings survived the lift', () => {
  it('gives every app glyph a box and at least one part', () => {
    for (const [name, glyph] of Object.entries(GLYPHS)) {
      expect(glyph.box, name).toMatch(/^[\d. -]+$/)
      const parts = glyph.groups.flatMap((g) => g.parts)
      expect(parts.length, name).toBeGreaterThan(0)
      for (const part of parts) {
        // A part is either a path or a rounded rectangle. One that is neither
        // was dropped by the extractor, and a dropped part is a mark that
        // renders as half of itself.
        expect(Boolean(part.d) || Boolean(part.rect), `${name} has an empty part`).toBe(true)
      }
    }
  })

  it('gives every brand mark a box and some markup', () => {
    for (const [name, brand] of Object.entries(BRANDS)) {
      expect(brand.box, name).toMatch(/^[\d. -]+$/)
      expect(brand.svg.length, name).toBeGreaterThan(20)
    }
  })

  it('leaves no JSX in a brand mark', () => {
    // The failure this catches is silent and total: three marks came out blank
    // on the phone with nothing in any log, because their source carried
    // `style={{ fill: ... }}` - React's own spelling, which a browser compiles
    // and an SVG parser does not understand at all. The generator translates
    // those now, and this is what says so when a new mark arrives carrying a
    // property nobody has taught it yet.
    for (const [name, brand] of Object.entries(BRANDS)) {
      expect(brand.svg, `${name} still carries JSX`).not.toMatch(/\w+=\{/)
    }
  })

  it('leaves no colour a stylesheet has to resolve', () => {
    // The second half of the same silent failure. `fill="var(--brand-putio-1)"`
    // is a colour only a browser can look up: react-native-svg accepts the
    // attribute, resolves nothing, and draws an invisible shape - which is how
    // OpenDrive, put.io and Quatrix reached a phone as three empty squares with
    // nothing in any log. They travel as `{{name}}` now, filled in at draw time
    // because that is the first moment the theme is known.
    for (const [name, brand] of Object.entries(BRANDS)) {
      expect(brand.svg, `${name} still carries a CSS colour`).not.toMatch(/var\(/)
      for (const slot of brand.svg.matchAll(/\{\{([^}]+)\}\}/g)) {
        expect(Object.keys(brand.vars), `${name} has no answer for ${slot[1]}`).toContain(slot[1]!)
      }
    }
  })

  it('keeps the marks that need a second colour on a dark page', () => {
    // Fourteen of them carry one, and the reason the count is asserted rather
    // than the names is that the stylesheet is allowed to gain another. Zero
    // means the generator misread it, which it did once: a
    // `:not([data-theme="dark"])` reads as "this block is the dark one" to a
    // plain substring test, and every mark came out with one colour twice.
    const swapped = Object.values(BRANDS).filter(
      (b) => b.fill !== null && typeof b.fill === 'object' && b.fill.light !== b.fill.dark,
    )
    expect(swapped.length).toBeGreaterThan(5)
  })
})
