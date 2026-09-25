import { useEffect, useId, useRef } from 'react'

import { CENTRE, FLIGHT, PIECES, RELEASE, TIP, frame, turnHalf, type Frame, type Point, type Pose } from '../lib/logoFlight'

/**
 * The logo's easter egg, painted frame by frame from logoFlight.ts. Drawn
 * inside LogoMark's arrow group, it moves the mark's own rings and arrows as
 * well, and calls `onRelease` the moment the ring lets go, for the rail's
 * shudder.
 *
 * Every frame is computed rather than keyed in CSS: WebKit, which draws the
 * desktop app on macOS and Linux, cannot animate a path's shape.
 */
export function LogoLoop({ onRelease }: { onRelease?: () => void }) {
  const root = useRef<SVGGElement>(null)
  // useId's characters are not all safe in a fragment reference.
  const ring = 'al-ring-' + useId().replace(/[^\w-]/g, '')
  const released = useRef(onRelease)
  released.current = onRelease

  useEffect(() => {
    const g = root.current
    const svg = g?.ownerSVGElement
    if (!g || !svg) return
    const doc = document.documentElement
    const level = doc.getAttribute('data-motion')
    // The storm plays even for reduced motion, since five taps asked for it.
    if (level === 'off') return
    if (level !== 'storm' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const seconds = parseFloat(getComputedStyle(doc).getPropertyValue('--motion-logo-dur'))
    const pace = seconds > 0 ? seconds / FLIGHT : 1

    const rings = svg.querySelector<SVGGElement>('.al-logo-rings')
    const up = svg.querySelector<SVGGElement>('.al-logo-up')
    const down = svg.querySelector<SVGGElement>('.al-logo-down')
    const paint = painter(g, ring)

    const start = performance.now()
    let shook = false
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / 1000 / pace, FLIGHT)
      const f = frame(t)
      paint(f)
      place(rings, f.rings.scale === 1 && !f.rings.dx && !f.rings.dy ? null : ringTransform(f.rings))
      for (const [el, sign] of [[up, 1], [down, -1]] as const) {
        if (!el) continue
        el.style.opacity = f.real.opacity === 1 ? '' : String(f.real.opacity)
        const o = f.real.offset * sign
        const tip: Point = sign > 0 ? TIP : [2 * CENTRE - TIP[0], 2 * CENTRE - TIP[1]]
        place(el, o || f.real.quiver ? `translate(${o} ${-o}) rotate(${f.real.quiver} ${tip[0]} ${tip[1]})` : null)
      }
      if (!shook && t >= RELEASE) {
        shook = true
        released.current?.()
      }
      if (t < FLIGHT) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      for (const el of [rings, up, down]) {
        place(el, null)
        if (el) el.style.opacity = ''
      }
      g.replaceChildren()
    }
  }, [ring])

  return <g ref={root} className="al-logo-loop" />
}

function place(el: SVGElement | null, transform: string | null) {
  if (!el) return
  if (transform) el.setAttribute('transform', transform)
  else el.removeAttribute('transform')
}

function ringTransform({ scale, dx, dy }: { scale: number; dx: number; dy: number }) {
  return `translate(${CENTRE + dx} ${CENTRE + dy}) scale(${scale.toFixed(4)}) translate(${-CENTRE} ${-CENTRE})`
}

const NS = 'http://www.w3.org/2000/svg'

function el<K extends keyof SVGElementTagNameMap>(parent: Element, name: K, attrs: Record<string, string> = {}) {
  const node = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  parent.appendChild(node)
  return node
}

interface Arrow {
  shaft: SVGPathElement
  shine: SVGPathElement
  tail: SVGGElement
  head: SVGGElement
  streaks: SVGPathElement[]
}

function arrow(parent: Element): Arrow {
  const g = el(parent, 'g')
  const shaft = el(g, 'path', { class: 'al-logo-shaft' })
  const shine = el(g, 'path', { class: 'al-logo-shine' })
  const tail = el(g, 'g')
  const feathers = el(tail, 'g', { transform: 'rotate(45) translate(-31.6,-252.9)' })
  for (const [fill, points] of FLETCH) el(feathers, 'polygon', { fill, points })
  const head = el(g, 'g')
  const point = el(head, 'g', { transform: 'rotate(45) translate(-244,-43.2)' })
  for (const [fill, points] of HEAD) el(point, 'polygon', { fill, points })
  const streaks = [0, 1, 2].map(() => el(g, 'path', { class: 'al-logo-streak' }))
  return { shaft, shine, tail, head, streaks }
}

const xy = ([x, y]: Point) => `${x.toFixed(1)},${y.toFixed(1)}`
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(2)

function draw(a: Arrow, pose: Pose) {
  const { points, headings } = pose
  a.shaft.setAttribute('d', 'M' + points.map(xy).join(' L'))
  // The highlight runs along one side of the shaft, whichever way it turns.
  const shine = points.slice(0, PIECES - 3).map(([x, y], k): Point => {
    const h = headings[Math.min(k, PIECES - 1)]
    return [x - Math.sin(h) * 4.2, y + Math.cos(h) * 4.2]
  })
  a.shine.setAttribute('d', 'M' + shine.map(xy).join(' L'))
  a.tail.setAttribute('transform', `translate(${xy(points[0])}) rotate(${deg(headings[0])})`)
  a.tail.style.opacity = String(pose.fletch)
  a.head.setAttribute('transform', `translate(${xy(points[PIECES])}) rotate(${deg(headings[PIECES - 1])})`)
}

function painter(g: SVGGElement, id: string) {
  const waves = [0, 1].map(() =>
    el(g, 'circle', { class: 'al-logo-wave', cx: String(CENTRE), cy: String(CENTRE), r: '0', opacity: '0' }),
  )
  const defs = el(g, 'defs')
  const ringGroup = el(defs, 'g', { id })
  const ringArrows = [arrow(ringGroup), arrow(ringGroup)]
  const ghosts = Array.from({ length: 7 }, () => el(g, 'use', { href: `#${id}`, opacity: '0' }))
  const spin = el(g, 'g')
  el(spin, 'use', { href: `#${id}` })
  const fly = el(g, 'g')
  const flyers = [arrow(fly), arrow(fly)]
  const turnAbout = (d: number) => `rotate(${d.toFixed(2)} ${CENTRE} ${CENTRE})`

  return (f: Frame) => {
    draw(ringArrows[0], f.ring)
    draw(ringArrows[1], turnHalf(f.ring))
    spin.setAttribute('transform', turnAbout(f.spin))
    spin.style.opacity = String(f.drawn)
    f.ghosts.forEach((ghost, i) => {
      ghosts[i].setAttribute('transform', turnAbout(ghost.spin))
      ghosts[i].setAttribute('opacity', ghost.opacity.toFixed(3))
    })
    fly.style.display = f.flyer ? '' : 'none'
    if (f.flyer) {
      draw(flyers[0], f.flyer.pose)
      draw(flyers[1], turnHalf(f.flyer.pose))
      fly.style.opacity = String(f.flyer.opacity)
      f.flyer.streaks.forEach(([a, b], i) => {
        flyers[0].streaks[i].setAttribute('d', `M${xy(a)} L${xy(b)}`)
        const mirror = (p: Point): Point => [2 * CENTRE - p[0], 2 * CENTRE - p[1]]
        flyers[1].streaks[i].setAttribute('d', `M${xy(mirror(a))} L${xy(mirror(b))}`)
      })
    }
    f.waves.forEach((w, i) => {
      waves[i].setAttribute('r', w.r.toFixed(1))
      waves[i].setAttribute('stroke-width', w.width.toFixed(2))
      waves[i].setAttribute('opacity', w.opacity.toFixed(3))
    })
  }
}

/** The arrowhead, in the drawing's greys, pointing along +x once turned. */
const HEAD: [string, string][] = [
  ['#72767d', '229.5 28.68 215 14.99 277.82 .02 277.94 0 264.59 65.54 251.45 50.85'],
  ['#b4b8b9', '241.05 40.35 277.82 .02 277.83 .02 277.94 0 264.59 65.54 251.45 50.85'],
]

/** The fletching, with the same turn. */
const FLETCH: [string, string][] = [
  ['#4d5054', '57.79 263.98 57.86 242.15 62.41 255.57 63.37 258.4 73.44 248.32 73.22 227.47 77.34 240.65 78.24 243.53 92.83 228.94 92.53 217.11 92.15 201.23 92.14 200.86 40.68 252.33 40.68 252.38 41.27 276.72 41.37 280.4 57.79 263.98'],
  ['#72767d', '78.24 243.53 92.83 228.94 92.53 217.11 92.15 201.23 92.14 200.86 89.29 203.72 89.3 204.08 89.55 214.56 89.89 228.1 77.34 240.65 78.24 243.53'],
  ['#72767d', '54.84 263.14 57.86 242.14 57.78 263.98 41.36 280.4 41.27 276.71 54.84 263.14'],
  ['#72767d', '63.37 258.4 73.44 248.32 73.22 227.47 70.51 247.48 62.41 255.57 63.37 258.4'],
  ['#72767d', '0 239.03 4.31 239.14 4.32 239.13 28.02 239.72 28.07 239.72 79.53 188.26 79.48 188.26 65.17 187.91 55.77 187.68 51.46 187.57 36.87 202.16 40.23 203.22 52.92 207.18 36.44 207.01 32.08 206.96 22 217.03 25.31 218.14 38.25 222.54 20.85 222.6 16.42 222.61 0 239.03'],
  ['#b4b8b9', '4.3 239.14 0 239.04 16.42 222.62 20.84 222.6 4.3 239.14'],
  ['#b4b8b9', '22 217.03 25.31 218.14 36.44 207.01 32.08 206.96 22 217.03'],
  ['#b4b8b9', '36.87 202.16 40.23 203.22 55.77 187.68 51.46 187.57 36.87 202.16'],
]
