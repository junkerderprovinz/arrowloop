import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// No brand mark may disappear into any surface it can sit on, at rest or under
// the pointer. The generator already refuses such a mark; this catches a hand
// edit. A mark that fails on one ground carries a custom property with a
// shifted lightness for that ground, so both values are checked.

const here = dirname(fileURLToPath(import.meta.url))
const glyphs = readFileSync(join(here, 'brandGlyphs.tsx'), 'utf8')
const themed = readFileSync(join(here, '..', 'brandGlyphs.css'), 'utf8')
const picker = readFileSync(join(here, 'ProviderPicker.tsx'), 'utf8')

/**
 * Every ground a mark can stand on, by theme. A dark tile hovers to white and
 * the mark switches to its light value there, so white is on the light list,
 * with --carbon-surface2 at rest and --carbon-surface3 under the pointer.
 */
const GROUNDS = {
  dunkel: ['#393939'],
  hell: ['#ffffff', '#e8e8e8', '#d1d1d1'],
}
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

/** The worst contrast a colour reaches on any ground that theme can show it. */
function worst(colour: string, theme: keyof typeof GROUNDS): number {
  return Math.min(...GROUNDS[theme].map((ground) => contrast(colour, ground)))
}

/**
 * Each mark's component name and every literal colour it paints with. Masks
 * are cut out first, since white inside one means "show this", not ink.
 */
function marks(): { name: string; colours: string[] }[] {
  return glyphs
    .split('export function ')
    .slice(1)
    .map((chunk) => ({
      name: chunk.slice(0, chunk.indexOf('(')),
      colours: [
        ...chunk
          .split('\n}')[0]
          .replace(/<mask\b[\s\S]*?<\/mask>/g, ' ')
          .matchAll(/"(#[0-9a-fA-F]{3,6}|rgb\([^"]*\))"/g),
      ].map((m) => m[1]),
    }))
    .filter((m) => m.colours.length > 0)
}

/** The two values behind each custom property, in theme order. */
function variables(): { name: string; dunkel: string; hell: string }[] {
  // From the selector to its closing brace: the dark rule spans two selector
  // lines and the light one is nested in a media query.
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
    // An empty list would let every assertion below pass.
    expect(marks().length).toBeGreaterThan(20)
    expect(variables().length).toBeGreaterThan(5)
  })

  it('gives every themed colour enough contrast on every ground', () => {
    const faint = variables().flatMap((v) => {
      const out: string[] = []
      if (worst(v.dunkel, 'dunkel') < FLOOR) out.push(`${v.name} dunkel`)
      if (worst(v.hell, 'hell') < FLOOR) out.push(`${v.name} hell`)
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
        // A two-tone mark with one visible half is still visible.
        const onDark = Math.max(...usable.map((c) => worst(c, 'dunkel')))
        const onLight = Math.max(...usable.map((c) => worst(c, 'hell')))
        return onDark < FLOOR || onLight < FLOOR
      })
      .map((m) => m.name)
    expect(faint, `needs a per-theme variant: ${faint.join(', ')}`).toEqual([])
  })

  // A tile that hovers to white must switch its marks to their light values,
  // and the two halves live in different files.
  it('gives every white hover the switch that goes with it', () => {
    expect(themed).toContain('[data-theme="dark"] .brand-hover-light:hover {')
    expect(picker).toContain('dark:hover:bg-white')
    expect(picker).toContain('brand-hover-light')
  })

  // Every mark carries width="1em", so a max-size cap never fires and the mark
  // stays a 16px square in a 48 by 96 box.
  it('lets a mark fill the tile rather than capping it', () => {
    expect(picker).toContain('[&_svg]:h-full')
    expect(picker).toContain('[&_svg]:w-full')
    expect(picker).not.toContain('[&_svg]:max-h-full')
  })

  // A spot check that the generator crops viewBoxes to their ink: Synology is a
  // wordmark and its box must stay wide.
  it('crops a wordmark to its ink', () => {
    const synology = glyphs.slice(glyphs.indexOf('export function IconSynology'))
    const box = synology.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number)
    expect(box[2] / box[3], 'Synology is a wordmark, not a square').toBeGreaterThan(2)
  })

  // Oracle Cloud is an outline with a 4-unit stroke on a path from 2 to 30, so
  // a box cropped to the path alone would slice half the stroke off.
  it('keeps a stroked mark inside its box', () => {
    const oracle = glyphs.slice(glyphs.indexOf('export function IconOracleCloud'))
    const head = oracle.slice(0, oracle.indexOf('\n}'))
    const [x, y, w, h] = head.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number)
    const stroke = Number(head.match(/strokeWidth="([\d.]+)"/)![1])
    // The path's own extent, then the room the box has to leave around it.
    expect(x, 'the box starts before the path').toBeLessThanOrEqual(2 - stroke / 2)
    expect(y, 'the box starts before the path').toBeLessThanOrEqual(2 - stroke / 2)
    expect(x + w, 'the box ends after the path').toBeGreaterThanOrEqual(30 + stroke / 2)
    expect(y + h, 'the box ends after the path').toBeGreaterThanOrEqual(18 + stroke / 2)
  })
})
