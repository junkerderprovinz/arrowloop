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

/** The shaft is a rod of this many pieces, drawn as one smooth curve through their joints. */
export const PIECES = 64

/** Where the upper arrow's shaft runs in the drawing, tail first. */
const SHAFT = 'M365.81,33.15 C342.0,57.0 298.9,118.0 265.7,123.6 C242.7,127.4 221.2,121.2 193.4,131.5 C173.9,138.6 149.0,180.4 156.9,202.1'

/** The upper arrow's point, where the new arrow quivers once it has struck. */
export const TIP: Point = [181.68, 251.07]

// The drawn arrows cover the real ones before anything moves: the two differ by
// a hair, and a crossfade between two moving shapes shows both.
const COVER = 0.08
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
// Quintic, so a phase starts and ends with neither speed nor acceleration and
// the hand-over to the next one cannot be seen.
const smooth = (t: number) => {
  const c = clamp(t)
  return c * c * c * (c * (6 * c - 15) + 10)
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

/**
 * The rod's direction at each of its joints, between the pieces either side;
 * at the two ends the bend carries on for half a piece, as a curve's would.
 */
export function tangents(headings: number[]): number[] {
  const n = headings.length
  const at = [1.5 * headings[0] - 0.5 * headings[1]]
  for (let k = 1; k < n; k++) at.push((headings[k - 1] + headings[k]) / 2)
  at.push(1.5 * headings[n - 1] - 0.5 * headings[n - 2])
  return at
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
    const p = smooth((t - COVER) / (PULL_END - COVER))
    const pull = 18 * p
    return {
      ...toward(-0.1 * p),
      tail: [S.tail[0] + pull * Math.SQRT1_2, S.tail[1] - pull * Math.SQRT1_2],
      fletch: 1,
    }
  }
  if (t < RING_AT) {
    const q = (t - PULL_END) / (RING_AT - PULL_END)
    const e = smooth(q)
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

// The spin's speed eases up while the arrows curl in, then grows
// exponentially, and the curve joining the two matches both its speed and how
// fast that grows. The top speed stays under a sixth of a turn per frame at
// 60 Hz: the two arrows look alike after half a turn, so a faster ring reads as
// turning backwards, and the ghosts carry the speed instead.
const W_START = 1.2 * TAU
const W_TOP = 9 * TAU
const GROWTH = Math.log(W_TOP / W_START) / (RELEASE - RING_AT)
const SPIN_FROM = PULL_END + 0.45 * (RING_AT - PULL_END)
const EASE_IN = RING_AT - SPIN_FROM
const BEND = GROWTH * EASE_IN

function rawTurn(t: number) {
  if (t <= SPIN_FROM) return 0
  const u = Math.min(t - SPIN_FROM, EASE_IN) / EASE_IN
  const easing = W_START * EASE_IN * (((3 - BEND) * u ** 3) / 3 + ((BEND - 2) * u ** 4) / 4)
  if (t <= RING_AT) return easing
  return easing + (W_START * (Math.exp(GROWTH * (Math.min(t, RELEASE) - RING_AT)) - 1)) / GROWTH
}

// Once the ring lets go, each arrow keeps turning for a moment and slows to a
// stop, so nothing on it changes speed in the frame it is thrown.
const COAST = 60

// Scaled so each head ends its coast pointing along the diagonal, out through
// the gap in the rings it came in by.
const TURN_SCALE = (() => {
  const nominal = rawTurn(RELEASE) + W_TOP / COAST
  const lastPiece = TAIL_ANGLE - (SPAN * (PIECES - 0.5)) / PIECES
  const want = (((lastPiece + 0.75 * Math.PI) % TAU) + TAU) % TAU
  return (want + Math.round((nominal - want) / TAU) * TAU) / nominal
})()

/** How far the ring has turned against the clock, in radians. */
export const turn = (t: number) => rawTurn(t) * TURN_SCALE

/** The ring's speed as it lets go, in radians a second. */
const LET_GO = W_TOP * TURN_SCALE

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

/** Noise that glides from one value to the next, so the shudder is the same at any frame rate. */
function wobble(t: number, seed: number) {
  const x = t * 30
  const i = Math.floor(x)
  return lerp(noise(i + seed), noise(i + 1 + seed), smooth(x - i))
}

const THROW = 760
const STRAIGHTEN = 75
// How far the squeezed rings swing back out once the ring lets go.
const KICK = 0.23

// The upper arrow at the moment it is thrown, in the drawing's frame, and how
// its head is moving then: square to the line from the centre, at the ring's
// speed.
const THROWN = (() => {
  const last = shape(RELEASE)
  const turned = turn(RELEASE)
  const [hx, hy] = rod(last.headings, last.length, 0, last.tail)[PIECES]
  const cos = Math.cos(-turned)
  const sin = Math.sin(-turned)
  const [cx, cy] = [hx - CENTRE, hy - CENTRE]
  const from: Point = [CENTRE + cx * cos - cy * sin, CENTRE + cx * sin + cy * cos]
  const r = Math.hypot(cx, cy)
  const moving: Point = [(from[1] - CENTRE) / r, -(from[0] - CENTRE) / r]
  const out = last.headings[PIECES - 1] - turned - LET_GO / COAST
  return {
    ...last,
    turned,
    from,
    speed: LET_GO * r,
    moving,
    out: [Math.cos(out), Math.sin(out)] as Point,
  }
})()

function fly(t: number): NonNullable<Frame['flyer']> {
  // The ring tears open: the arrow coasts on with the ring's turn, straightens
  // along the way its head points and leaves, stretched by its speed.
  const tau = t - RELEASE
  const p = clamp(tau / FLY)
  const spun = 1 - Math.exp(-COAST * tau)
  const turned = THROWN.turned + (LET_GO / COAST) * spun
  const world = THROWN.headings.map((h) => h - turned)
  const head = world[PIECES - 1]
  // Starts from rest, so in the first instant each piece moves just as it did on the ring.
  const straight = 1 - (1 + STRAIGHTEN * tau) * Math.exp(-STRAIGHTEN * tau)
  const headings = world.map((h) => lerp(h, head, straight))
  // The throw starts at the speed the head already has and gains the rest of
  // its pace within a couple of frames.
  const d = THROW * outPow(p, 2.4) - ((THROW * 2.4) / FLY - THROWN.speed) * tau * Math.exp(-tau / 0.02)
  const drift = (THROWN.speed / COAST) * spun
  const { from, out, moving } = THROWN
  const at: Point = [
    from[0] + out[0] * d + (moving[0] - out[0]) * drift,
    from[1] + out[1] * d + (moving[1] - out[1]) * drift,
  ]
  const points = rod(headings, THROWN.length * (1 + 0.35 * straight * (1 - p)), PIECES, at)
  const dir: Point = [Math.cos(head), Math.sin(head)]
  const trail = 190 * Math.pow(1 - p, 1.5) * straight
  const streaks = [-12, 0, 12].map((o): [Point, Point] => {
    const a: Point = [points[0][0] - dir[1] * o, points[0][1] + dir[0] * o]
    return [a, [a[0] - dir[0] * trail, a[1] - dir[1] * trail]]
  })
  return { pose: { points, headings, fletch: 0 }, opacity: 1 - smooth((p - 0.5) / 0.5), streaks }
}

export function frame(t: number): Frame {
  const now = shape(Math.min(t, RELEASE))
  const ring: Pose = {
    points: rod(now.headings, now.length, 0, now.tail),
    headings: now.headings,
    fletch: now.fletch,
  }
  const released = t >= RELEASE
  const tau = t - RELEASE
  // Everything still moving at the end comes to rest exactly on the last frame.
  const settle = 1 - smooth((t - FLIGHT + 0.2) / 0.2)

  // The ghosts keep the speed the ring let go at and fade with the throw.
  const at = Math.min(t, RELEASE - 0.001)
  const speed = (turn(at + 0.001) - turn(at)) / 0.001
  const blur = smooth((speed / TAU - 2.5) / 9) * (1 - smooth(tau / 0.08))
  const ghosts = Array.from({ length: GHOSTS }, (_, j) => ({
    spin: -toDegrees(turn(Math.max(0, t - (j + 1) * 0.007))),
    opacity: 0.34 * (1 - j / GHOSTS) * blur,
  }))

  const flyer = released && t < RELEASE + FLY ? fly(t) : null

  // Tension builds in the rings as the ring spins up; the release lets them
  // swing out from the squeeze and the new arrows knock them once more as they
  // strike.
  const tension = clamp((Math.min(t, RELEASE) - RING_AT) / (RELEASE - RING_AT)) ** 2
  let scale = 1 - 0.06 * tension
  let shake = 5 * tension
  if (released) {
    const swing = TAU * 3.4 * tau
    let out = Math.exp(-5.5 * tau) * (-0.06 * Math.cos(swing) + KICK * Math.sin(swing))
    const hit = t - STRIKE - STRIKE_IN
    if (hit > 0) out += 0.045 * Math.exp(-9 * hit) * Math.sin(TAU * 6 * hit)
    scale = 1 + out * settle
    shake *= 1 - smooth(tau / 0.08)
  }
  const dx = (wobble(t, 0) - 0.5) * shake
  const dy = (wobble(t, 99) - 0.5) * shake

  const waves = [0, 0.07].map((lag, i) => {
    const p = (t - RELEASE - lag) / 0.42
    if (p < 0 || p > 1) return { r: 0, width: 0, opacity: 0 }
    const opacity = 0.8 * smooth(p / 0.12) * Math.pow(1 - p, 1.4) * (i ? 0.5 : 1)
    return { r: 70 + 250 * outPow(p, 3), width: 20 * (1 - p), opacity }
  })

  let real = { opacity: 1, offset: 0, quiver: 0 }
  if (t > 0 && t < FLIGHT) {
    if (t < STRIKE) real = { opacity: 1 - smooth((t - COVER) / 0.03), offset: 0, quiver: 0 }
    else {
      const hit = t - STRIKE - STRIKE_IN
      real = {
        opacity: smooth((t - STRIKE) / 0.08),
        offset: 470 * (1 - outPow((t - STRIKE) / STRIKE_IN, 4)),
        quiver: hit > 0 ? 7 * settle * Math.exp(-6 * hit) * Math.sin(TAU * 8 * hit) : 0,
      }
    }
  }

  return {
    ring,
    spin: -toDegrees(turn(t)),
    ghosts,
    drawn: released || t <= 0 ? 0 : smooth(t / COVER),
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
 * The rail's shudder as keyframes for Element.animate: a shove that swings back
 * three times, smaller each time, the shape KnightLoader's rail takes after
 * its blow. Every swing is a keyframe of its own, so none falls between two.
 */
export function shudder(amplitude: number): Keyframe[] {
  const swings: [number, number, number][] = [
    [0, 0, 0],
    [0.15, 1, 0.4],
    [0.32, -0.6, 0],
    [0.5, 0.4, 0],
    [0.7, -0.2, 0],
    [1, 0, 0],
  ]
  return swings.map(([offset, x, y]) => ({
    offset,
    transform: `translate(${(x * amplitude).toFixed(2)}px, ${(y * amplitude).toFixed(2)}px)`,
  }))
}
