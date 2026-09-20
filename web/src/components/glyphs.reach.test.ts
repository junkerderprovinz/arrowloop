import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Reach is the distance from a glyph's centre to its furthest ink, as a
// fraction of its box; a frame-filling round glyph sits at 0.5. A cross that
// fills its box puts its tips in the corners and reaches sqrt(2) further, which
// is what makes it look too big beside its neighbours even at equal extent.

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

describe('cross and check reach', () => {
  it('puts the cross tips exactly where a round glyph puts its ink', () => {
    const [x, y, w, h] = boxOf('IconCancel')
    expect(w).toBe(h)
    const cx = x + w / 2
    const cy = y + h / 2

    // Rotating about the box centre cannot change the tip radius.
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
    // Icon sets keep a diagonal mark a hair inside the circle keyline.
    expect(reach / w).toBeGreaterThan(0.44)
    expect(reach / w).toBeLessThanOrEqual(0.5)
  })
})

describe('the arrows carry no bar', () => {
  // move-left.svg and move-right.svg put a "jump to the end" bar behind the
  // arrowhead; the bare arrow is arrow-up-1.svg, turned.
  it.each(['IconUp', 'IconToLeft', 'IconToRight', 'IconBothWays'])(
    '%s is the bare arrow, turned',
    (name) => {
      const body = bodyOf(name)
      expect(body).toMatch(/rotate\(-?90 7 7\)/)
      // The bar's rounded corners are the only arcs; the bare arrow has none.
      expect(body).not.toMatch(/a1\.5 1\.5 0 0 0/i)
    },
  )

  it('names the bare arrow as the source', () => {
    expect(source).not.toContain('move-left.svg')
    expect(source).not.toContain('move-right.svg')
  })
})
