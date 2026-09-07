import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Reach, which is the thing "this glyph is too big" actually means.
 *
 * jdp reported the cross and the check as not matching their neighbours, and
 * the same complaint cost BombVault three rounds because each round measured
 * something true that was not the complaint: extent, then painted area, then
 * reach. Reach is the distance from the centre to the furthest ink. A cross
 * puts its four tips on the CORNERS of its box; a round glyph puts its ink on
 * the edge midpoints. Fill the same box with both and the cross reaches
 * sqrt(2) further, while extent and area can agree exactly.
 *
 * So this file measures reach as a fraction of the box, where a frame-filling
 * round glyph sits at 0.5, and it measures it on the two marks the rule is
 * about. Both assertions fail in both directions on purpose: a mark that grows
 * back to the corners fails, and one shrunk into a dot fails too.
 */

const require_ = createRequire(import.meta.url)
const source = readFileSync(
  require_.resolve('./glyphs.tsx').replace(/\.js$/, ''),
  'utf8',
)

/** The viewBox of one exported glyph, as four numbers. */
function boxOf(name: string): [number, number, number, number] {
  const fn = source.split(`export function ${name}(`)[1]
  expect(fn, `${name} is not exported from glyphs.tsx`).toBeDefined()
  const found = /box="([^"]+)"/.exec(fn)
  expect(found, `${name} has no viewBox`).not.toBeNull()
  const parts = (found as RegExpExecArray)[1].trim().split(/\s+/).map(Number)
  expect(parts).toHaveLength(4)
  return parts as [number, number, number, number]
}

/** The body of one exported glyph, up to its closing brace. */
function bodyOf(name: string): string {
  const after = source.split(`export function ${name}(`)[1]
  expect(after, `${name} is not exported from glyphs.tsx`).toBeDefined()
  return after.split('\n}')[0]
}

describe('the marks that had to be made to agree with the set', () => {
  it('puts the cross tips exactly where a round glyph puts its ink', () => {
    const [x, y, w, h] = boxOf('IconCancel')
    expect(w).toBe(h)
    const cx = x + w / 2
    const cy = y + h / 2

    // The cross is one bar rotated about the box centre, so the tip radius is
    // half the bar's length, and the rotation cannot move it.
    const bars = [...bodyOf('IconCancel').matchAll(
      /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g,
    )]
    expect(bars, 'the cross should be drawn from two rectangles').toHaveLength(2)

    const turn = /rotate\(45 ([-\d.]+) ([-\d.]+)\)/.exec(bodyOf('IconCancel'))
    expect(turn, 'the cross is a plus turned 45 degrees').not.toBeNull()
    expect(Number((turn as RegExpExecArray)[1])).toBeCloseTo(cx, 6)
    expect(Number((turn as RegExpExecArray)[2])).toBeCloseTo(cy, 6)

    for (const bar of bars) {
      const bx = Number(bar[1])
      const by = Number(bar[2])
      const bw = Number(bar[3])
      const bh = Number(bar[4])
      // Distance from the centre to the far end of this bar, along its own
      // axis. Rotating about the centre leaves it unchanged.
      const reach = Math.max(
        Math.abs(bx - cx), Math.abs(bx + bw - cx),
        Math.abs(by - cy), Math.abs(by + bh - cy),
      )
      expect(reach / w).toBeCloseTo(0.5, 2)
    }
  })

  it('keeps the check inside the same circle', () => {
    const [x, y, w, h] = boxOf('IconConfirm')
    expect(w).toBe(h)
    const cx = x + w / 2
    const cy = y + h / 2

    const body = bodyOf('IconConfirm')
    const d = /<path d="([^"]+)"/.exec(body)
    expect(d, 'the check should be one stroked path').not.toBeNull()
    const stroke = /strokeWidth="([\d.]+)"/.exec(body)
    expect(stroke, 'a stroked mark needs a width to measure').not.toBeNull()
    // Round caps, so the ink runs half a stroke past every end point.
    expect(body).toContain('strokeLinecap="round"')
    const cap = Number((stroke as RegExpExecArray)[1]) / 2

    const points = [...(d as RegExpExecArray)[1].matchAll(/([\d.]+)\s+([\d.]+)/g)]
      .map((p) => [Number(p[1]), Number(p[2])] as const)
    expect(points.length, 'a check has three points').toBe(3)

    const reach = Math.max(
      ...points.map(([px, py]) => Math.hypot(px - cx, py - cy) + cap),
    )
    // Just inside the round glyphs' 0.5, never past it. A diagonal mark sitting
    // a hair inside the circle keyline is what icon sets do on purpose; sitting
    // outside it is the complaint.
    expect(reach / w).toBeGreaterThan(0.44)
    expect(reach / w).toBeLessThanOrEqual(0.5)
  })
})

describe('the arrows carry no bar', () => {
  // move-left.svg and move-right.svg draw a full-height rounded rectangle
  // behind the arrowhead. That is the "jump to the end" keyboard idea, and jdp
  // reported it on both the folder picker's up button and the direction button.
  // The bare arrow is arrow-up-1.svg, turned.
  it.each(['IconUp', 'IconToLeft', 'IconToRight', 'IconBothWays'])(
    '%s is the bare arrow, turned',
    (name) => {
      const body = bodyOf(name)
      expect(body).toMatch(/rotate\(-?90 7 7\)/)
      // The bar is a 1.5-radius rounded rectangle spanning the full 14 units of
      // height. Its signature in the source path is the "A1.5 1.5 0 0 0 ... 14"
      // run; the bare arrow has no arc at all.
      expect(body).not.toMatch(/a1\.5 1\.5 0 0 0/i)
    },
  )

  it('names the bare arrow as the source', () => {
    expect(source).not.toContain('move-left.svg')
    expect(source).not.toContain('move-right.svg')
  })
})
