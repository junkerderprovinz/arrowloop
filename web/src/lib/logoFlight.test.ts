import { describe, expect, it } from 'vitest'

import { CENTRE, FLIGHT, PIECES, RELEASE, frame } from './logoFlight'

const times = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)

const angle = (r: number) => (((r * 180) / Math.PI) % 360 + 360) % 360

describe("the logo's flight", () => {
  it('starts and ends as the plain logo', () => {
    for (const t of [0, FLIGHT]) {
      const f = frame(t)
      expect(f.drawn).toBe(0)
      expect(f.flyer).toBeNull()
      expect(f.real).toEqual({ opacity: 1, offset: 0, quiver: 0 })
      expect(f.rings.scale).toBeCloseTo(1, 2)
    }
  })

  it('turns the ring the way its heads point', () => {
    // Against the clock on screen, which is a falling SVG angle.
    const spins = times(0, RELEASE, 0.01).map((t) => frame(t).spin)
    spins.slice(1).forEach((s, i) => expect(s).toBeLessThanOrEqual(spins[i]))

    // A head moving against the clock has its heading to the left of the
    // line from the centre, which is a negative cross product with y down.
    const { points, headings } = frame(RELEASE - 0.01).ring
    const [x, y] = points[PIECES]
    const h = headings[PIECES - 1]
    expect((x - CENTRE) * Math.sin(h) - (y - CENTRE) * Math.cos(h)).toBeLessThan(0)
  })

  it('never turns so far in one frame that the ring seems to go backwards', () => {
    // The two arrows look alike after half a turn, so a step near 90 degrees
    // is already ambiguous.
    const frameTime = 1 / 60
    const steps = times(0, RELEASE - frameTime, 0.005).map((t) => frame(t).spin - frame(t + frameTime).spin)
    expect(Math.max(...steps)).toBeLessThan(60)
  })

  it('throws each arrow out along the diagonal, through the gap it came in by', () => {
    const f = frame(RELEASE + 0.1)
    expect(f.flyer).not.toBeNull()
    const heading = f.flyer?.pose.headings[PIECES - 1] ?? 0
    expect(angle(heading)).toBeCloseTo(135, 0)
  })

  it('keeps the shaft a rod in every frame', () => {
    for (const t of times(0, RELEASE + 0.25, 0.05)) {
      const f = frame(t)
      for (const pose of [f.ring, f.flyer?.pose]) {
        if (!pose) continue
        const gaps = pose.points.slice(1).map((p, i) => Math.hypot(p[0] - pose.points[i][0], p[1] - pose.points[i][1]))
        expect(Math.max(...gaps) - Math.min(...gaps), `at ${t.toFixed(2)}s`).toBeLessThan(0.01)
      }
    }
  })

  it('brings new arrows in from outside and settles them in place', () => {
    const arriving = times(RELEASE, FLIGHT, 0.01).map((t) => frame(t).real.offset)
    expect(Math.max(...arriving)).toBeGreaterThan(400)
    expect(arriving[arriving.length - 1]).toBe(0)
  })
})
