import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A coin logo has to carry its own ground, or read on the tile's.
 *
 * The provider marks answer readability one way: a single-ink wordmark has
 * nothing behind it but the row, so its colour is measured against the row and
 * shifted when it fails. The coins answer it the other way. Each is a filled
 * disc in the brand's colour with a white symbol on it, so the thing that
 * decides whether the logo can be READ is the symbol against the disc - the
 * brand's own number, and the same on any tile it lands on.
 *
 * That is what makes "original colour" safe here and not there, so it is what
 * this guards. Take the disc away and the argument goes with it: the mark
 * becomes a bare glyph on a grey tile, and Bitcoin's orange measures 1.50
 * against the light theme's.
 */

const here = dirname(fileURLToPath(import.meta.url))
const marks = readFileSync(join(here, 'donateMarks.tsx'), 'utf8')
const themed = readFileSync(join(here, '..', 'donateMarks.css'), 'utf8')

/** Every ground a coin tile can show, by theme: --carbon-surface2 at rest,
 *  --carbon-surface3 under the pointer. */
const GROUNDS = {
  dunkel: ['#393939', '#525252'],
  hell: ['#e8e8e8', '#d1d1d1'],
}
/** Below this a mark is not readable. Dropbox sits at 2.28 and reads fine. */
const FLOOR = 2.0

/**
 * Where the brand's OWN lockup sits under the floor, and at exactly what.
 *
 * Binance draws a white diamond on #F3BA2F, which measures 1.77. That is
 * Binance's decision about Binance's logo, and repainting it to clear a floor
 * of ours would be the one thing this whole file exists not to do - it would
 * no longer be their mark.
 *
 * The number is written down rather than the coin being waved through, so this
 * stays a guard. Change the disc or the symbol by a shade and the measurement
 * no longer matches what is recorded here, and the test fails asking why.
 */
const BRAND_OWN: Record<string, number> = { bnb: 1.77 }

function rgb(colour: string): [number, number, number] {
  let hex = colour.trim().replace('#', '')
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

function contrast(a: string, b: string): number {
  const lum = ([r, g, bl]: [number, number, number]) => {
    const f = (v: number) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl)
  }
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Each coin's entry in the COINS table, as written. */
function coins(): { id: string; body: string }[] {
  const table = marks.slice(marks.indexOf('const COINS'), marks.indexOf('\n};', marks.indexOf('const COINS')))
  return [...table.matchAll(/^ {2}(\w+): \(\n([\s\S]*?)^ {2}\),$/gm)].map((m) => ({
    id: m[1],
    body: m[2],
  }))
}

/** The two values behind a custom property in donateMarks.css, in theme order. */
function variable(name: string): { dunkel: string; hell: string } {
  const read = (selector: string) => {
    const at = themed.indexOf(selector + ' {')
    const body = themed.slice(at, themed.indexOf('}', at))
    return body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? ''
  }
  return { dunkel: read('[data-theme="dark"]'), hell: read('[data-theme="light"]') }
}

/** What a colour resolves to in one theme: a hex as written, or the value
 *  behind the custom property it names. */
function resolve(colour: string, theme: keyof typeof GROUNDS): string {
  const named = colour.match(/var\((--[\w-]+)\)/)
  return named ? variable(named[1])[theme] : colour
}

describe('coin marks', () => {
  it('reads the table', () => {
    // Guards the guard: an empty list would let every assertion below pass.
    expect(coins().map((c) => c.id).sort()).toEqual([
      'bnb', 'btc', 'eth', 'sol', 'sui', 'usdc', 'usdt', 'xrp',
    ])
  })

  it('gives every coin a disc to stand on', () => {
    const bare = coins().filter((c) => !/<circle[^/]*r="16"/.test(c.body)).map((c) => c.id)
    expect(bare, `no disc, so nothing to read against: ${bare.join(', ')}`).toEqual([])
  })

  it('keeps every symbol readable on its own disc, in both themes', () => {
    const faint: string[] = []
    for (const coin of coins()) {
      const disc = coin.body.match(/<circle[^>]*fill="([^"]+)"/)![1]
      // Everything else the mark paints with. Readable if ANY part of it
      // stands out - the house rule for a two-tone mark, and Solana's bars are
      // a gradient whose purple end carries what its green end cannot.
      const ink = [...coin.body.matchAll(/(?:fill|stopColor)="(#[0-9a-fA-F]{3,6}|var\([^"]+\))"/g)]
        .map((m) => m[1])
        .filter((c) => c !== disc)
      for (const theme of ['dunkel', 'hell'] as const) {
        const ground = resolve(disc, theme)
        const best = Math.max(...ink.map((c) => contrast(resolve(c, theme), ground)))
        const allowed = BRAND_OWN[coin.id]
        if (allowed !== undefined) {
          // Held to the recorded number, not excused from measurement.
          expect(best, `${coin.id} ${theme} moved off its recorded value`).toBeCloseTo(allowed, 2)
          continue
        }
        if (best < FLOOR) faint.push(`${coin.id} ${theme} (${best.toFixed(2)})`)
      }
    }
    expect(faint, `symbol lost in its own disc: ${faint.join(', ')}`).toEqual([])
  })

  it('keeps every themed disc off the tile it sits on', () => {
    // A disc that follows the theme does so because the fixed one vanished
    // into the tile, so the values it flips to have to clear the floor there.
    const faint: string[] = []
    for (const coin of coins()) {
      const disc = coin.body.match(/<circle[^>]*fill="(var\([^"]+\))"/)?.[1]
      if (!disc) continue
      for (const theme of ['dunkel', 'hell'] as const) {
        for (const ground of GROUNDS[theme]) {
          const seen = contrast(resolve(disc, theme), ground)
          if (seen < FLOOR) faint.push(`${coin.id} ${theme} on ${ground} (${seen.toFixed(2)})`)
        }
      }
    }
    expect(faint, `disc lost in the tile: ${faint.join(', ')}`).toEqual([])
  })

  it('leaves the two button marks monochrome', () => {
    // PayPal and Buy Me a Coffee sit beside a label on a filled button, where
    // a glyph takes the label's ink like every other glyph in the app - and
    // neither carries a disc to stand on. A fixed hex here would be the same
    // mistake as a coin without one: PayPal's navy measures 1.03 on that fill.
    for (const name of ['IconPayPal', 'IconBuyMeACoffee']) {
      const body = marks.slice(marks.indexOf(`export function ${name}`))
      expect(body.slice(0, body.indexOf('\n}')), name).not.toMatch(/#[0-9a-fA-F]{6}/)
    }
  })
})
