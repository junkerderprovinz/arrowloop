/**
 * The logo's easter egg as numbers, one frame at a time: the arrows slide along
 * the rings' gap into the middle and curl into a ring, the ring spins up the way
 * the heads point, tears open and throws the arrows out, and two new arrows
 * strike home. LogoLoop.tsx paints what this returns.
 *
 * Everything is in the drawing's units about its centre, in seconds at the
 * lively pace; the motion level stretches time, not the shapes. Only the upper
 * arrow is computed. The lower one is the same arrow turned half a turn, which
 * the drawing is.
 */

export type Point = [number, number]

export const CENTRE = 205.87

/** The shaft is a rod of this many straight pieces. */
export const PIECES = 64

/** Where the upper arrow's shaft runs in the drawing, tail first. */
const SHAFT = 'M352,58 C314,98 288,120 254,127 C220,134 196,146 186,168 C176,188 175,206 179,224'

/** The upper arrow's point, where the new arrow quivers once it has struck. */
export const TIP: Point = [181.68, 251.07]

const PULL_END = 0.2
const RING_AT = 0.85
export const RELEASE = 1.95
const FLY = 0.26
const STRIKE = RELEASE + 0.16
const STRIKE_IN = 0.18
export const FLIGHT = STRIKE + STRIKE_IN + 0.62

const R_START = 80
const R_END = 72
const SPAN = (160 * Math.PI) / 180
const TAIL_ANGLE = -Math.PI / 4
const TAU = Math.PI * 2

const clamp = (x: number) => Math.min(1, Math.max(0, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => {
  const c = clamp(t)
  return c * c * (3 - 2 * c)
}
const inOut = (t: number) => {
  const c = clamp(t)
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}
const outPow = (t: number, k: number) => 1 - Math.pow(1 - clamp(t), k)

function sampleShaft(d: string) {
  const n = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number)
  const curves: Point[][] = []
  let from: Point = [n[0], n[1]]
  for (let i = 2; i + 5 < n.length; i += 6) {
    const to: Point = [n[i + 4], n[i + 5]]
    curves.push([from, [n[i], n[i + 1]], [n[i + 2], n[i + 3]], to])
    from = to
  }
  const dense: Point[] = []
  for (const [a, b, c, e] of curves) {
    for (let k = 0; k < 200; k++) {
      const t = k / 200
      const u = 1 - t
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
      dense.push([
        w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * e[0],
        w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * e[1],
      ])
    }
  }
  dense.push(from)
  const run = [0]
  for (let i = 1; i < dense.length; i++) {
    run.push(run[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
  }
  const length = run[run.length - 1]
  const points: Point[] = []
  let j = 0
  for (let k = 0; k <= PIECES; k++) {
    const want = (length * k) / PIECES
    while (j < run.length - 2 && run[j + 1] < want) j++
    const f = (want - run[j]) / (run[j + 1] - run[j] || 1)
    points.push([lerp(dense[j][0], dense[j + 1][0], f), lerp(dense[j][1], dense[j + 1][1], f)])
  }
  const headings: number[] = []
  for (let k = 0; k < PIECES; k++) {
    headings.push(Math.atan2(points[k + 1][1] - points[k][1], points[k + 1][0] - points[k][0]))
  }
  for (let k = 1; k < PIECES; k++) {
    while (headings[k] - headings[k - 1] > Math.PI) headings[k] -= TAU
    while (headings[k] - headings[k - 1] < -Math.PI) headings[k] += TAU
  }
  return { headings, length, tail: points[0] }
}

// Bending blends the headings of the pieces, so every frame is a rod that
// could exist; blending points instead squashes the shaft in between.
const S = sampleShaft(SHAFT)
const ARC = (() => {
  const h: number[] = []
  for (let k = 0; k < PIECES; k++) h.push(TAIL_ANGLE - (SPAN * (k + 0.5)) / PIECES - Math.PI / 2)
  const turn = Math.round((S.headings[0] - h[0]) / TAU) * TAU
  return h.map((x) => x + turn)
})()

const onRing = (r: number): Point => [CENTRE + Math.cos(TAIL_ANGLE) * r, CENTRE + Math.sin(TAIL_ANGLE) * r]
const PULLED: Point = [S.tail[0] + 18 * Math.SQRT1_2, S.tail[1] - 18 * Math.SQRT1_2]

/** Lays the pieces end to end and moves the rod so piece `at` sits on `pos`. */
export function rod(headings: number[], length: number, at: number, pos: Point): Point[] {
  const step = length / PIECES
  const p: Point[] = [[0, 0]]
  for (let k = 0; k < PIECES; k++) {
    p.push([p[k][0] + Math.cos(headings[k]) * step, p[k][1] + Math.sin(headings[k]) * step])
  }
  const dx = pos[0] - p[at][0]
  const dy = pos[1] - p[at][1]
  return p.map(([x, y]) => [x + dx, y + dy])
}

interface Shape {
  headings: number[]
  length: number
  tail: Point
  /** How much of the fletching shows; it folds away as the ring closes. */
  fletch: number
}

function shape(t: number): Shape {
  const toward = (m: number) => ({
    headings: S.headings.map((x, k) => lerp(x, ARC[k], m)),
    length: lerp(S.length, SPAN * R_START, m),
  })
  if (t < PULL_END) {
    const p = t / PULL_END
    const pull = 18 * outPow(p, 3)
    return {
      ...toward(-0.1 * smooth(p)),
      tail: [S.tail[0] + pull * Math.SQRT1_2, S.tail[1] - pull * Math.SQRT1_2],
      fletch: 1,
    }
  }
  if (t < RING_AT) {
    const q = (t - PULL_END) / (RING_AT - PULL_END)
    const e = inOut(q)
    const end = onRing(R_START)
    return {
      ...toward(lerp(-0.1, 1, smooth(q * 1.08 - 0.04))),
      tail: [lerp(PULLED[0], end[0], e), lerp(PULLED[1], end[1], e)],
      fletch: 1 - smooth((q - 0.4) / 0.4),
    }
  }
  // The ring tightens while it spins up, and once more just before it breaks.
  const r = lerp(R_START, R_END, smooth((t - RING_AT) / (RELEASE - RING_AT))) - 12 * smooth((t - RELEASE + 0.1) / 0.1)
  return { headings: ARC, length: SPAN * r, tail: onRing(r), fletch: 0 }
}

// The spin's speed grows linearly while the arrows curl in, then
// exponentially. The top speed stays under a sixth of a turn per frame at
// 60 Hz: the two arrows look alike after half a turn, so a faster ring reads as
// turning backwards, and the ghosts carry the speed instead.
const W_START = 1.2 * TAU
const W_TOP = 9 * TAU
const GROWTH = Math.log(W_TOP / W_START) / (RELEASE - RING_AT)
const SPIN_FROM = PULL_END + 0.45 * (RING_AT - PULL_END)

function rawTurn(t: number) {
  if (t <= SPIN_FROM) return 0
  if (t <= RING_AT) return (W_START * (t - SPIN_FROM) ** 2) / (2 * (RING_AT - SPIN_FROM))
  const atRing = (W_START * (RING_AT - SPIN_FROM)) / 2
  return atRing + (W_START * (Math.exp(GROWTH * (Math.min(t, RELEASE) - RING_AT)) - 1)) / GROWTH
}

// Scaled so the ring lets go with each head pointing along the diagonal, out
// through the gap in the rings it came in by.
const TURN_SCALE = (() => {
  const nominal = rawTurn(RELEASE)
  const lastPiece = TAIL_ANGLE - (SPAN * (PIECES - 0.5)) / PIECES
  const want = (((lastPiece + 0.75 * Math.PI) % TAU) + TAU) % TAU
  return (want + Math.round((nominal - want) / TAU) * TAU) / nominal
})()

/** How far the ring has turned against the clock, in radians. */
export const turn = (t: number) => rawTurn(t) * TURN_SCALE

export interface Pose {
  points: Point[]
  headings: number[]
  fletch: number
}

export interface Frame {
  /** The upper arrow in the ring's own frame, before it turns. */
  ring: Pose
  /** The ring's turn as an SVG rotation, in degrees. */
  spin: number
  /** Copies of the ring a little behind it, for the blur of its speed. */
  ghosts: { spin: number; opacity: number }[]
  /** The drawn arrows, fading in over the real ones and out on the release. */
  drawn: number
  /** The upper arrow once the ring has let go, in the drawing's frame. */
  flyer: { pose: Pose; opacity: number; streaks: [Point, Point][] } | null
  rings: { scale: number; dx: number; dy: number }
  waves: { r: number; width: number; opacity: number }[]
  /** The real arrows: how visible, and the upper one's offset and quiver. */
  real: { opacity: number; offset: number; quiver: number }
}

const GHOSTS = 7
const toDegrees = (r: number) => (r * 180) / Math.PI

/** A cheap repeatable noise, so a frame looks the same every time it is drawn. */
function noise(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}

export function frame(t: number): Frame {
  const now = shape(Math.min(t, RELEASE))
  const ring: Pose = {
    points: rod(now.headings, now.length, 0, now.tail),
    headings: now.headings,
    fletch: now.fletch,
  }
  const released = t >= RELEASE
  const fadeIn = smooth((t - 0.03) / 0.09)
  const speed = (turn(t + 0.001) - turn(t)) / 0.001
  const blur = clamp((speed / TAU - 2.5) / 9)

  const ghosts = Array.from({ length: GHOSTS }, (_, j) => ({
    spin: -toDegrees(turn(Math.max(0, t - (j + 1) * 0.007))),
    opacity: released ? 0 : 0.34 * (1 - j / GHOSTS) * blur,
  }))

  let flyer: Frame['flyer'] = null
  if (released && t < RELEASE + FLY) {
    // The ring tears open: the arrow straightens along the way its head points
    // and leaves at full speed, stretched by it.
    const p = clamp((t - RELEASE) / FLY)
    const straight = outPow((t - RELEASE) / 0.07, 3)
    const last = shape(RELEASE)
    const turned = turn(RELEASE)
    const world = last.headings.map((h) => h - turned)
    const head = world[PIECES - 1]
    const headings = world.map((h) => lerp(h, head, straight))
    const [hx, hy] = rod(last.headings, last.length, 0, last.tail)[PIECES]
    const [cx, cy] = [hx - CENTRE, hy - CENTRE]
    const cos = Math.cos(-turned)
    const sin = Math.sin(-turned)
    const from: Point = [CENTRE + cx * cos - cy * sin, CENTRE + cx * sin + cy * cos]
    const dir: Point = [Math.cos(head), Math.sin(head)]
    const d = 760 * outPow(p, 2.4)
    const points = rod(headings, last.length * (1 + 0.35 * (1 - p)), PIECES, [from[0] + dir[0] * d, from[1] + dir[1] * d])
    const trail = 190 * Math.pow(1 - p, 1.5)
    const streaks = [-12, 0, 12].map((o): [Point, Point] => {
      const a: Point = [points[0][0] - dir[1] * o, points[0][1] + dir[0] * o]
      return [a, [a[0] - dir[0] * trail, a[1] - dir[1] * trail]]
    })
    flyer = { pose: { points, headings, fletch: 0 }, opacity: 1 - smooth((p - 0.5) / 0.5), streaks }
  }

  // Tension builds in the rings as the ring spins up; the release kicks them
  // out and the new arrows knock them once more as they strike.
  let scale = 1
  let dx = 0
  let dy = 0
  if (t > RING_AT && t < RELEASE) {
    const k = clamp((t - RING_AT) / (RELEASE - RING_AT)) ** 2
    const f = Math.floor(t * 60)
    scale = 1 - 0.06 * k
    dx = (noise(f) - 0.5) * 5 * k
    dy = (noise(f + 99) - 0.5) * 5 * k
  } else if (released) {
    const tau = t - RELEASE
    scale = 1 + 0.15 * Math.exp(-5.5 * tau) * Math.cos(TAU * 3.4 * tau)
    const hit = t - STRIKE - STRIKE_IN
    if (hit > 0) scale += 0.045 * Math.exp(-9 * hit) * Math.sin(TAU * 6 * hit)
  }

  const waves = [0, 0.07].map((lag, i) => {
    const p = (t - RELEASE - lag) / 0.42
    if (p < 0 || p > 1) return { r: 0, width: 0, opacity: 0 }
    return { r: 70 + 250 * outPow(p, 3), width: 20 * (1 - p), opacity: 0.8 * Math.pow(1 - p, 1.4) * (i ? 0.5 : 1) }
  })

  let real = { opacity: 1, offset: 0, quiver: 0 }
  if (t > 0 && t < FLIGHT) {
    if (t < STRIKE) real = { opacity: 1 - fadeIn, offset: 0, quiver: 0 }
    else {
      const hit = t - STRIKE - STRIKE_IN
      real = {
        opacity: 1,
        offset: 470 * (1 - outPow((t - STRIKE) / STRIKE_IN, 4)),
        quiver: hit > 0 ? 7 * Math.exp(-6 * hit) * Math.sin(TAU * 8 * hit) : 0,
      }
    }
  }

  return {
    ring,
    spin: -toDegrees(turn(t)),
    ghosts,
    drawn: released || t <= 0 ? 0 : fadeIn,
    flyer,
    rings: { scale, dx, dy },
    waves,
    real,
  }
}

/** The other arrow: the drawing turned half a turn about its centre. */
export function turnHalf(pose: Pose): Pose {
  return {
    points: pose.points.map(([x, y]) => [2 * CENTRE - x, 2 * CENTRE - y]),
    headings: pose.headings.map((h) => h + Math.PI),
    fletch: pose.fletch,
  }
}

/**
 * The rail's shudder as keyframes for Element.animate: a sideways swing that
 * dies away, as a fraction of the level's amplitude.
 */
export function shudder(amplitude: number): Keyframe[] {
  return Array.from({ length: 25 }, (_, i) => {
    const tau = (i / 24) * 0.7
    const x = amplitude * Math.exp(-7 * tau) * Math.sin(TAU * 12 * tau)
    return { offset: i / 24, transform: `translateX(${x.toFixed(2)}px)` }
  })
}
