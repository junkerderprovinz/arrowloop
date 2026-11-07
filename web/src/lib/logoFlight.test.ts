import { describe, expect, it } from 'vitest'

import { CENTRE, FLIGHT, PIECES, RELEASE, frame, shudder, tangents, type Point } from './logoFlight'

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

  it("starts from the logo's own arrow", () => {
    // Where the drawn head and fletching land exactly on the drawing's.
    const { points, headings } = frame(0).ring
    const along = tangents(headings)
    expect(points[0][0]).toBeCloseTo(365.81, 1)
    expect(points[0][1]).toBeCloseTo(33.15, 1)
    expect(points[PIECES][0]).toBeCloseTo(156.9, 1)
    expect(points[PIECES][1]).toBeCloseTo(202.12, 1)
    expect(Math.abs(angle(along[0]) - 135)).toBeLessThan(1.5)
    expect(Math.abs(angle(along[PIECES]) - 70.07)).toBeLessThan(1.5)
  })
})

describe("the logo's flight, frame by frame", () => {
  // At 60 Hz and the pace of the fastest level, which plays the flight in 2.5 s.
  const step = FLIGHT / 2.5 / 60
  const frames = times(0, FLIGHT, step).concat(FLIGHT)
  const gap = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

  /** The upper arrow as it is seen: the ring turned by its spin, or the flyer. */
  function seen(t: number): Point[] {
    const f = frame(t)
    if (f.flyer) return f.flyer.pose.points
    const a = (f.spin * Math.PI) / 180
    return f.ring.points.map(([x, y]): Point => [
      CENTRE + (x - CENTRE) * Math.cos(a) - (y - CENTRE) * Math.sin(a),
      CENTRE + (x - CENTRE) * Math.sin(a) + (y - CENTRE) * Math.cos(a),
    ])
  }

  it('keeps the drawn arrows still until they cover the real ones', () => {
    const rest = frame(0).ring.points
    for (const t of times(0, 0.2, 0.002)) {
      const f = frame(t)
      // The drawn arrows lie on top, so the real ones show only through them.
      expect(f.drawn + f.real.opacity * (1 - f.drawn), `at ${t.toFixed(3)}s`).toBeGreaterThan(0.999)
      if (f.drawn < 1) expect(Math.max(...f.ring.points.map((p, k) => gap(p, rest[k])))).toBeLessThan(0.01)
    }
  })

  it('bends the arrows into the ring without a jolt', () => {
    // A change of speed between two frames, which is what an easing that only
    // meets its neighbour in value looks like.
    const moved = (from: Point, to: Point): Point => [to[0] - from[0], to[1] - from[1]]
    const bending = frames.filter((t) => t < RELEASE)
    for (let i = 2; i < bending.length; i++) {
      const [a, b, c] = [frame(bending[i - 2]), frame(bending[i - 1]), frame(bending[i])]
      const jolt = Math.max(...c.ring.points.map((p, k) => gap(moved(b.ring.points[k], p), moved(a.ring.points[k], b.ring.points[k]))))
      expect(jolt, `at ${bending[i].toFixed(3)}s`).toBeLessThan(3.5)
      expect(Math.abs(c.spin - 2 * b.spin + a.spin), `at ${bending[i].toFixed(3)}s`).toBeLessThan(2.5)
    }
  })

  it('throws each arrow from where the ring held it, at the speed it had', () => {
    const h = 1e-5
    const before = seen(RELEASE - h)
    const after = seen(RELEASE)
    expect(Math.max(...before.map((p, k) => gap(p, after[k])))).toBeLessThan(0.5)
    const speedIn = seen(RELEASE - 2 * h).map((p, k): Point => [(before[k][0] - p[0]) / h, (before[k][1] - p[1]) / h])
    const later = seen(RELEASE + h)
    const speedOut = after.map((p, k): Point => [(later[k][0] - p[0]) / h, (later[k][1] - p[1]) / h])
    const head = Math.hypot(...speedIn[PIECES])
    expect(Math.max(...speedIn.map((v, k) => gap(v, speedOut[k])))).toBeLessThan(head * 0.03)
  })

  it('fades everything in and out over several frames', () => {
    const shown = (t: number) => {
      const f = frame(t)
      return {
        arrow: t >= RELEASE ? (f.flyer?.opacity ?? 0) : f.drawn,
        real: f.real.opacity * (1 - f.drawn),
        fletch: f.ring.fletch,
        ghost: Math.max(...f.ghosts.map((g) => g.opacity)),
        wave: Math.max(...f.waves.map((w) => w.opacity)),
      }
    }
    for (let i = 1; i < frames.length; i++) {
      const [a, b] = [shown(frames[i - 1]), shown(frames[i])]
      for (const key of Object.keys(a) as (keyof typeof a)[]) {
        expect(Math.abs(b[key] - a[key]), `${key} at ${frames[i].toFixed(3)}s`).toBeLessThan(0.5)
      }
    }
  })

  it('swells the rings and grows the streaks instead of popping them', () => {
    for (let i = 1; i < frames.length; i++) {
      const [a, b] = [frame(frames[i - 1]), frame(frames[i])]
      expect(Math.abs(b.rings.scale - a.rings.scale), `at ${frames[i].toFixed(3)}s`).toBeLessThan(0.12)
      const streak = (f: typeof a) => (f.flyer ? gap(...f.flyer.streaks[1]) : 0)
      expect(Math.abs(streak(b) - streak(a)), `at ${frames[i].toFixed(3)}s`).toBeLessThan(100)
    }
  })

  it('comes to rest exactly, with no last twitch', () => {
    const last = frame(FLIGHT)
    expect(last.rings.scale).toBe(1)
    expect(Math.abs(last.rings.dx) + Math.abs(last.rings.dy)).toBe(0)
    expect(last.real).toEqual({ opacity: 1, offset: 0, quiver: 0 })
    const before = frame(FLIGHT - step)
    expect(Math.abs(before.rings.scale - 1)).toBeLessThan(1e-3)
    expect(Math.abs(before.real.quiver)).toBeLessThan(0.05)
  })
})

describe("the rail's shudder", () => {
  const sideways = (k: Keyframe) => Number(/translate\((-?[\d.]+)px/.exec(String(k.transform))![1])

  it('shoves the full amplitude first and swings back smaller each time', () => {
    const swings = shudder(7).map(sideways)
    expect(swings[0]).toBe(0)
    expect(swings[1]).toBe(7)
    for (let i = 2; i < swings.length - 1; i++) {
      expect(Math.sign(swings[i])).toBe(-Math.sign(swings[i - 1]))
      expect(Math.abs(swings[i])).toBeLessThan(Math.abs(swings[i - 1]))
    }
    expect(swings.at(-1)).toBe(0)
  })

  it('stands still at the off level', () => {
    expect(shudder(0).every((k) => sideways(k) === 0)).toBe(true)
  })
})
