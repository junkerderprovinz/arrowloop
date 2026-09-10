import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No mark may disappear into the surface it sits on.
 *
 * "Original und farbig" has one failure mode that is not a matter of taste: a
 * logo drawn in navy or black cannot be seen on a dark row, and one drawn in
 * near-white cannot be seen on a light one. Measured on the running app before
 * this was fixed, ShareFile reached 1.07 against the dark row and OpenCloud
 * 1.09 - they were there and could not be seen. Six marks were in that state,
 * four of them for as long as the list has existed, and nobody noticed until
 * the logos got big enough to look at.
 *
 * The generator already refuses to emit such a mark, so this guards the file
 * against a hand-edit - which the header of brandGlyphs.tsx asks nobody to
 * make, and which somebody will make anyway.
 *
 * A mark that fails on one ground carries its colour as a custom property and
 * that property holds a shifted lightness for that ground, so BOTH values have
 * to be checked, each against its own surface.
 */

const here = dirname(fileURLToPath(import.meta.url))
const glyphs = readFileSync(join(here, 'brandGlyphs.tsx'), 'utf8')
const themed = readFileSync(join(here, '..', 'brandGlyphs.css'), 'utf8')

/** --carbon-surface2 in each theme: what a row in the picker is filled with. */
const SURFACE = { dunkel: '#393939', hell: '#e8e8e8' }
/** Below this a mark is not readable. Dropbox sits at 2.28 and reads fine. */
const FLOOR = 2.0

function rgb(colour: string): [number, number, number] | null {
  const text = colour.trim()
  if (text.startsWith('rgb')) {
    const parts = text.match(/[\d.]+%?/g)?.slice(0, 3)
    if (!parts || parts.length < 3) return null
    return parts.map((p) =>
      p.endsWith('%') ? Math.round((parseFloat(p) * 255) / 100) : Math.round(parseFloat(p)),
    ) as [number, number, number]
  }
  let hex = text.replace('#', '')
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return null
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(rgb(a)!), luminance(rgb(b)!)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Each mark's component name and every literal colour it paints with. */
function marks(): { name: string; colours: string[] }[] {
  return glyphs
    .split('export function ')
    .slice(1)
    .map((chunk) => ({
      name: chunk.slice(0, chunk.indexOf('(')),
      colours: [...chunk.split('\n}')[0].matchAll(/"(#[0-9a-fA-F]{3,6}|rgb\([^"]*\))"/g)].map(
        (m) => m[1],
      ),
    }))
    .filter((m) => m.colours.length > 0)
}

/** The two values behind each custom property, in theme order. */
function variables(): { name: string; dunkel: string; hell: string }[] {
  // From the selector to its closing brace. Splitting on line starts does not
  // work here: the dark rule spans two selector lines and the light one is
  // nested inside a media query.
  const read = (selector: string) => {
    const at = themed.indexOf(selector + ' {')
    if (at < 0) return {}
    const body = themed.slice(at, themed.indexOf('}', at))
    return Object.fromEntries(
      [...body.matchAll(/(--brand-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    )
  }
  const dark = read('[data-theme="dark"]')
  const light = read('[data-theme="light"]')
  return Object.keys(dark).map((name) => ({ name, dunkel: dark[name], hell: light[name] }))
}

describe('brand contrast', () => {
  it('reads both generated files', () => {
    // Guards the guard: an empty list would let every assertion below pass.
    expect(marks().length).toBeGreaterThan(20)
    expect(variables().length).toBeGreaterThan(5)
  })

  it('gives every themed colour enough contrast on both grounds', () => {
    const faint = variables().flatMap((v) => {
      const out: string[] = []
      if (contrast(v.dunkel, SURFACE.dunkel) < FLOOR) out.push(`${v.name} dunkel`)
      if (contrast(v.hell, SURFACE.hell) < FLOOR) out.push(`${v.name} hell`)
      return out
    })
    expect(faint, `too faint to see: ${faint.join(', ')}`).toEqual([])
  })

  it('leaves no mark painting a fixed colour it cannot be seen in', () => {
    // A mark that never needed a variant paints its own colour on both
    // grounds, so it has to clear the floor on both.
    const faint = marks()
      .filter((m) => m.colours.some((c) => rgb(c)))
      .filter((m) => {
        const usable = m.colours.filter((c) => rgb(c))
        // Readable if ANY part of it stands out - a two-tone mark with one
        // visible half is still a visible mark.
        const onDark = Math.max(...usable.map((c) => contrast(c, SURFACE.dunkel)))
        const onLight = Math.max(...usable.map((c) => contrast(c, SURFACE.hell)))
        return onDark < FLOOR || onLight < FLOOR
      })
      .map((m) => m.name)
    expect(faint, `needs a per-theme variant: ${faint.join(', ')}`).toEqual([])
  })
})
