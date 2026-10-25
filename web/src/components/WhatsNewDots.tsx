// The glowing dots that mark what an update changed. A changed element carries
// data-new with the id of its change, and a dot is drawn over the page at its
// corner. A change on another page puts a dot on every link that leads there.
// The changes the open page does not draw at the moment, such as a card that
// only appears when something waits, share one dot on the page's own corner,
// since a row of dots there would point at nothing in particular. A change
// drawn in a window waits on the control that opens it, when it names one.
//
// The dots live in one layer in <body> rather than inside the components, so
// marking a change costs its component one attribute and no layout.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useTipBubble } from '../lib/glimstone/useTipBubble'
import { useT } from '../lib/i18n'
import { useLocation } from '../lib/router'
import { isAt, matchRoute, placed, sentenceOf, trail, type PlacedChange } from '../lib/whatsNew'
import { markSeen, type WhatsNew } from '../lib/whatsNewStore'

/** The navigation: the rail, the bottom bar, its More sheet and the settings column. */
const NAV_LINKS = 'nav a[href], [data-nav-rail] a[href], [role="tablist"] a[href]'

// A page's entrance, a tab's slide and a card's arrival move what the dots
// stand on without changing the document, so the dots follow for this long
// after anything did.
const SETTLE_MS = 700

// A page that reads its data draws its cards a moment after it opens. Only
// after this long does a change count as not drawn there.
const ARRIVED_MS = 1200

/** How far inside the corner of its element a dot's centre stands. */
const INSET = 4
/** The same for a page's corner. */
const EDGE_INSET = 12
/** How far apart two dots stand that would share a corner. */
const APART = 20

interface Target {
  key: string
  el: HTMLElement
  /** `change` stands on the changed element, `page` on the page for what it does not draw, `way` on a link. */
  kind: 'change' | 'page' | 'way'
  changes: PlacedChange[]
}

const drawn = (el: Element): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0

function pathOf(a: HTMLAnchorElement): string {
  return new URL(a.href).pathname.replace(/\/+$/, '') || '/'
}

/**
 * The elements a step of the way stands on: every link of the navigation to
 * it, or else the first one on the page, which for a route with a `:name` is
 * the first row that leads to such a page. A row that is no link says where it
 * leads in data-new-way.
 */
function stepElements(step: string): HTMLElement[] {
  const matches = (a: HTMLAnchorElement) => matchRoute(step, pathOf(a))
  const nav = Array.from(document.querySelectorAll<HTMLAnchorElement>(NAV_LINKS)).filter((a) => drawn(a) && matches(a))
  if (nav.length > 0) return nav
  const named = Array.from(document.querySelectorAll(`[data-new-way="${step}"]`)).find(drawn)
  if (named) return [named]
  const inPage = Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href]')).find((a) => drawn(a) && matches(a))
  return inPage ? [inPage] : []
}

const wayKeys = new WeakMap<Element, string>()
let wayCount = 0

function wayKey(el: Element): string {
  let key = wayKeys.get(el)
  if (!key) wayKeys.set(el, (key = `way:${wayCount++}`))
  return key
}

/** Where each unseen change is marked: on its element, on its page or on the links that lead there. */
function collect(unseen: PlacedChange[], here: string, arrived: boolean): Target[] {
  const marked = new Map<string, HTMLElement>()
  for (const el of document.querySelectorAll('[data-new]')) {
    const id = el.getAttribute('data-new') ?? ''
    if (!marked.has(id) && drawn(el)) marked.set(id, el)
  }
  const page = document.querySelector<HTMLElement>('[data-settings-content]') ?? document.querySelector<HTMLElement>('main')

  const targets: Target[] = []
  const undrawn: PlacedChange[] = []
  const ways = new Map<HTMLElement, PlacedChange[]>()
  const lead = (el: HTMLElement, change: PlacedChange) => ways.set(el, [...(ways.get(el) ?? []), change])
  for (const change of unseen) {
    const el = marked.get(change.id)
    if (el) {
      targets.push({ key: `change:${change.id}`, el, kind: 'change', changes: [change] })
      continue
    }
    if (isAt(change, here)) {
      const opener = change.via && Array.from(document.querySelectorAll<HTMLElement>(`[data-new-way="${change.via}"]`)).find(drawn)
      if (opener) lead(opener, change)
      else if (arrived && page) undrawn.push(change)
      continue
    }
    let found = false
    for (const route of change.at) {
      const on = trail(route, here).flatMap(stepElements)
      if (on.length === 0) continue
      for (const link of on) lead(link, change)
      found = true
      break
    }
    // A narrow window keeps the places its bar has no room for behind More.
    const more = found ? undefined : Array.from(document.querySelectorAll('[data-new-way="more"]')).find(drawn)
    if (more) lead(more, change)
  }
  if (page && undrawn.length > 0) targets.push({ key: 'page', el: page, kind: 'page', changes: undrawn })
  for (const [el, changes] of ways) targets.push({ key: wayKey(el), el, kind: 'way', changes })
  return targets
}

function same(a: Target[], b: Target[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]
      return x.key === y.key && x.el === y.el && x.changes.length === y.changes.length && x.changes.every((c, j) => c.id === y.changes[j].id)
    })
  )
}

/** Whether a box between the element and the page cuts the point off. */
function cutOff(el: HTMLElement, x: number, y: number): boolean {
  for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(box)
    if (overflowX === 'visible' && overflowY === 'visible') continue
    const edge = box.getBoundingClientRect()
    if (x < edge.left || x > edge.right || y < edge.top || y > edge.bottom) return true
  }
  return false
}

/** Where the dot of a target stands, or null while its corner cannot be seen. */
function spot(target: Target, rtl: boolean, front: Element | null): { x: number; y: number } | null {
  // A window over the page hides the marks of everything behind it.
  if (front && !front.contains(target.el)) return null
  const r = target.el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  const inset = target.kind === 'page' ? EDGE_INSET : INSET
  const x = Math.round(rtl ? r.left + inset : r.right - inset)
  const y = Math.round(r.top + inset)
  return target.kind !== 'page' && cutOff(target.el, x, y) ? null : { x, y }
}

function inside(at: { x: number; y: number }, el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom
}

function Dot({ target, register }: { target: Target; register: (key: string, el: HTMLElement | null) => void }) {
  const { t, lang } = useT()
  const way = target.kind === 'way'
  const sentences = target.changes.map((c) => sentenceOf(t, c))
  const count = target.changes.length
  const tip = way ? [t(`new.way.${new Intl.PluralRules(lang).select(count)}`, { count }), ...sentences].join(' ') : sentences.join(' ')
  const bubble = useTipBubble(tip)
  return (
    <>
      <button
        type="button"
        ref={(el) => {
          bubble.ref(el)
          register(target.key, el)
        }}
        {...bubble.handlers}
        aria-label={tip}
        aria-describedby={bubble.describedBy}
        data-new-dot={target.kind === 'change' ? target.changes[0].id : target.kind}
        onClick={() => {
          bubble.hide()
          // A dot on a link goes where the link goes; any other has been read.
          if (way) target.el.click()
          else markSeen(target.changes.map((c) => c.id))
        }}
        className="glim-new-dot"
      />
      {bubble.bubble}
    </>
  )
}

/**
 * Draws a dot for every unseen change a page draws, where it is or on the way
 * to it. `active` is false during the first start, where nothing can be new.
 */
export function WhatsNewDots({ news, active }: { news: WhatsNew | null; active: boolean }) {
  const here = useLocation().pathname.replace(/\/+$/, '') || '/'
  const [targets, setTargets] = useState<Target[]>([])
  const layer = useRef<HTMLDivElement>(null)
  const dots = useRef(new Map<string, HTMLElement>())
  const live = useRef(targets)
  live.current = targets
  const unseen = useMemo(() => news?.unseen.filter(placed), [news])
  const on = active && !!unseen && unseen.length > 0

  const placeAll = () => {
    const rtl = document.documentElement.dir === 'rtl'
    const windows = document.querySelectorAll('[aria-modal="true"]')
    const front = windows.length > 0 ? windows[windows.length - 1] : null
    const spots = new Map<Target, { x: number; y: number } | null>()
    for (const target of live.current) spots.set(target, spot(target, rtl, front))
    const taken: { x: number; y: number }[] = []
    for (const target of live.current) {
      const dot = dots.current.get(target.key)
      if (!dot) continue
      const at = spots.get(target) ?? null
      // A control carries one dot. When the corner of a changed strip or page
      // lands on a control inside it that has a dot of its own, that one stays.
      const covered =
        !!at &&
        live.current.some((other) => other !== target && spots.get(other) && target.el.contains(other.el) && inside(at, other.el))
      dot.style.display = at && !covered ? '' : 'none'
      if (!at || covered) continue
      // Two dots on one corner stand side by side, so each can be pointed at.
      while (taken.some((p) => Math.abs(p.x - at.x) < APART && Math.abs(p.y - at.y) < APART)) {
        at.x += rtl ? APART : -APART
      }
      taken.push(at)
      dot.style.left = `${at.x}px`
      dot.style.top = `${at.y}px`
    }
  }

  useEffect(() => {
    if (!on || !unseen) {
      setTargets([])
      return
    }
    let arrived = false
    let frame = 0
    let until = 0
    const refresh = () => {
      frame = 0
      const next = collect(unseen, here, arrived)
      if (same(next, live.current)) placeAll()
      else setTargets(next)
      if (performance.now() < until) frame = requestAnimationFrame(refresh)
    }
    const wake = () => {
      until = performance.now() + SETTLE_MS
      if (!frame) frame = requestAnimationFrame(refresh)
    }
    // The layer changes with every answer and must not ask again.
    const changed = new MutationObserver((records) => {
      if (records.some((r) => !layer.current?.contains(r.target))) wake()
    })
    changed.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-modal'],
    })
    document.addEventListener('scroll', wake, true)
    window.addEventListener('resize', wake)
    const arrival = window.setTimeout(() => {
      arrived = true
      wake()
    }, ARRIVED_MS)
    wake()
    return () => {
      changed.disconnect()
      document.removeEventListener('scroll', wake, true)
      window.removeEventListener('resize', wake)
      window.clearTimeout(arrival)
      cancelAnimationFrame(frame)
    }
    // placeAll reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, unseen, here])

  // Before paint, so a dot never shows at the layer's corner first.
  useLayoutEffect(placeAll)

  if (!on) return null
  return createPortal(
    <div ref={layer} data-new-layer className="glim-new-layer">
      {targets.map((target) => (
        <Dot
          key={target.key}
          target={target}
          register={(key, el) => {
            if (el) dots.current.set(key, el)
            else dots.current.delete(key)
          }}
        />
      ))}
    </div>,
    document.body,
  )
}
