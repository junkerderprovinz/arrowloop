// Reordering a column by dragging, as GlimStone's "Reordering by dragging"
// describes it and BombVault's lib/dragLift.ts does it: the carried item lifts
// and follows the pointer, the others slide aside while it passes, and on
// release it slides into its gap. Escape or a cancelled pointer slides
// everything back and writes nothing. tokens.css draws the three states from
// the --drag-* tokens; the code here sets only each item's `translate` and
// switches the classes.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { flushSync } from 'react-dom'

const LIFT = 'glim-drag-lift'
const SHIFT = 'glim-drag-shift'
const SETTLE = 'glim-drag-settle'

/** How far a mouse press travels before it becomes a drag: Windows' SM_CXDRAG. */
const THRESHOLD_PX = 5

/**
 * A finger arms a drag by holding this long, and moving further than
 * HOLD_SLOP_PX first makes it a scroll or a tap instead.
 */
const HOLD_MS = 300
const HOLD_SLOP_PX = 8

function liftScale(node: HTMLElement): number {
  return parseFloat(getComputedStyle(node).getPropertyValue('--drag-lift-scale')) || 1
}

function settleMs(node: HTMLElement): number {
  return Math.max(0, ...getComputedStyle(node).transitionDuration.split(',').map(parseFloat)) * 1000
}

/** The vertical translate a node is painted with, a slide in flight included. */
function shiftOf(node: HTMLElement): number {
  const t = getComputedStyle(node).translate
  return t === 'none' ? 0 : parseFloat(t.split(' ')[1] ?? '0') || 0
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at])
}

/** The item a press lifted, measured when it armed. */
interface Lifted {
  id: string
  downY: number
  top: number
  height: number
  /** The range its top may take, inset by what the scale adds, so a column that scrolls grows no scrollbar. */
  min: number
  max: number
  scale: number
}

interface Press {
  id: string
  x: number
  y: number
  pointerId: number
  /** A finger arms by holding still; a mouse or pen by moving past the threshold. */
  hold: boolean
}

export interface Reorder {
  /** The order to draw: the live one while an item is carried or landing. */
  order: string[]
  /** The item in the hand, or null. */
  held: string | null
  press: (e: ReactPointerEvent<HTMLElement>, id: string) => void
  /** The drag class for an item: lifted, landing, making room or none. */
  look: (id: string) => string
  /**
   * For the item's click handler: whether this click is the release of a drag
   * and has to be swallowed, since the items are links. Only a pointer's click
   * counts; a key or a screen reader activates with a detail of 0.
   */
  endsDrag: (e: { detail: number }) => boolean
}

/**
 * The drag gesture for a column of ids. `container` is the items' offsetParent,
 * and `attr` the attribute carrying each item's id. `onReorder` gets the full
 * new order after a drop that changed it.
 */
export function useReorder(
  ids: readonly string[],
  container: RefObject<HTMLElement | null>,
  attr: string,
  onReorder: (ids: string[]) => void,
): Reorder {
  // liveOrder is the order laid out while an item is held or landing, and
  // null otherwise. Positions go straight to each item's `translate` rather
  // than through state, so the held item keeps up with the pointer.
  const [held, setHeld] = useState<string | null>(null)
  const [settling, setSettling] = useState<string | null>(null)
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null)
  const holdTimer = useRef<number | null>(null)
  const pressed = useRef<Press | null>(null)
  const pointerY = useRef(0)
  const lifted = useRef<Lifted | null>(null)
  // Where each item was painted before liveOrder moved it, for the slide.
  const slideFrom = useRef<Map<string, number> | null>(null)
  const swallow = useRef(false)

  // Mirrors for the document listeners, which bind once.
  const liveRef = useRef<string[] | null>(null)
  liveRef.current = liveOrder
  const idsRef = useRef(ids)
  idsRef.current = ids
  const onReorderRef = useRef(onReorder)
  onReorderRef.current = onReorder

  const nodes = (): HTMLElement[] => Array.from(container.current?.querySelectorAll<HTMLElement>(`[${attr}]`) ?? [])
  const nodeOf = (id: string) => nodes().find((node) => node.getAttribute(attr) === id)

  function cancelPress() {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    pressed.current = null
  }

  function press(e: ReactPointerEvent<HTMLElement>, id: string) {
    // A second finger during a drag does not start another.
    if (e.button !== 0 || lifted.current) return
    cancelPress()
    const hold = e.pointerType === 'touch'
    pressed.current = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, hold }
    pointerY.current = e.clientY
    swallow.current = false
    if (hold) {
      const downY = e.clientY
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null
        lift(id, downY)
      }, HOLD_MS)
    }
  }

  function lift(id: string, downY: number) {
    const node = nodeOf(id)
    if (!node) return
    const all = nodes()
    const scale = liftScale(node)
    const grow = ((scale - 1) / 2) * node.offsetHeight
    const top = Math.min(...all.map((n) => n.offsetTop))
    const bottom = Math.max(...all.map((n) => n.offsetTop + n.offsetHeight))
    lifted.current = {
      id,
      downY,
      top: node.offsetTop,
      height: node.offsetHeight,
      min: top + grow,
      max: bottom - node.offsetHeight - grow,
      scale,
    }
    setSettling(null)
    setHeld(id)
    setLiveOrder([...idsRef.current])
  }

  /**
   * Where the held item's top goes for the current pointer. Only the drawn
   * item is kept inside the column: aimed from there, the lift's inset would
   * leave the first and last slots out of reach.
   */
  function heldAt(h: Lifted, drawn: boolean): number {
    const y = h.top + pointerY.current - h.downY
    return drawn ? Math.min(Math.max(y, h.min), h.max) : y
  }

  function placeHeld(h: Lifted) {
    const node = nodeOf(h.id)
    if (!node) return
    // Before any layout is read, so the scale changes in the same style pass
    // as the lift class that transitions it.
    node.style.scale = String(h.scale)
    node.style.translate = `0px ${heldAt(h, true) - node.offsetTop}px`
  }

  /**
   * The order the held item's position asks for. An item counts as before it
   * once the held item's centre passes the item's centre. Measured boxes, so
   * a tile taller than its neighbours is aimed at correctly.
   */
  function aim(h: Lifted): string[] {
    const centre = heldAt(h, false) + h.height / 2
    const rest: string[] = []
    let ahead = 0
    for (const node of nodes()) {
      const id = node.getAttribute(attr)
      if (!id || id === h.id) continue
      if (node.offsetTop + node.offsetHeight / 2 < centre) ahead++
      rest.push(id)
    }
    rest.splice(ahead, 0, h.id)
    return rest
  }

  function painted(): Map<string, number> {
    const out = new Map<string, number>()
    for (const node of nodes()) {
      const id = node.getAttribute(attr)
      if (id) out.set(id, node.offsetTop + shiftOf(node))
    }
    return out
  }

  function release(h: Lifted) {
    lifted.current = null
    swallow.current = true
    const node = nodeOf(h.id)
    if (node) node.style.scale = ''
    setHeld(null)
    setSettling(h.id)
  }

  // After every render, since a new liveOrder moves the items in the DOM: the
  // held item is placed under the pointer again, and every item the order
  // moved starts from where it was painted and slides to its new slot.
  useLayoutEffect(() => {
    const h = lifted.current
    if (h) placeHeld(h)
    const from = slideFrom.current
    if (!from) return
    slideFrom.current = null
    const moved: HTMLElement[] = []
    for (const node of nodes()) {
      const id = node.getAttribute(attr)
      const was = id ? from.get(id) : undefined
      if (was === undefined || id === h?.id) continue
      const dy = was - node.offsetTop
      if (dy === 0) continue
      node.style.transition = 'none'
      node.style.translate = `0px ${dy}px`
      moved.push(node)
    }
    if (moved.length === 0) return
    // Reading layout commits the jump back, so the transition starts from there.
    void container.current?.offsetWidth
    for (const node of moved) {
      node.style.transition = ''
      node.style.translate = '0px 0px'
    }
  })

  // The dropped item slides into its slot, and once it has landed the offsets
  // and liveOrder go, leaving the order to `ids`.
  useLayoutEffect(() => {
    if (!settling) return
    const node = nodeOf(settling)
    let ms = 0
    if (node) {
      node.style.translate = '0px 0px'
      ms = settleMs(node)
    }
    const timer = window.setTimeout(() => {
      for (const n of nodes()) n.style.translate = ''
      setSettling(null)
      setLiveOrder(null)
    }, ms)
    return () => window.clearTimeout(timer)
    // nodeOf and nodes read the container's DOM, not render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settling])

  // The list's element can change under the hook, as when the settings strip
  // gives way to the column, and its guards have to move with it.
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (container.current !== el) setEl(container.current)
  })

  // Once armed the gesture is the drag's: a long press opens no context menu
  // and a moving finger does not scroll. Bound natively, since React's
  // touchmove listener is passive and cannot cancel.
  useEffect(() => {
    if (!el) return
    function onMenu(e: Event) {
      if (lifted.current || pressed.current?.hold) e.preventDefault()
    }
    function onTouchMove(e: TouchEvent) {
      if (lifted.current) e.preventDefault()
    }
    el.addEventListener('contextmenu', onMenu)
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      el.removeEventListener('contextmenu', onMenu)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [el])

  // On the document, so a pointer that leaves the pressed item is still tracked.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const p = pressed.current
      if (!p || e.pointerId !== p.pointerId) return
      pointerY.current = e.clientY
      const h = lifted.current
      if (!h) {
        const dx = Math.abs(e.clientX - p.x)
        const dy = Math.abs(e.clientY - p.y)
        // Moving before a hold arms makes it a tap or a scroll.
        if (p.hold) {
          if (dx > HOLD_SLOP_PX || dy > HOLD_SLOP_PX) cancelPress()
        } else if (dx >= THRESHOLD_PX || dy >= THRESHOLD_PX) {
          lift(p.id, p.y)
        }
        return
      }
      placeHeld(h)
      const next = aim(h)
      const shown = liveRef.current
      if (shown && !sameOrder(next, shown)) {
        slideFrom.current = painted()
        setLiveOrder(next)
      }
    }

    function onUp(e: PointerEvent) {
      if (e.pointerId !== pressed.current?.pointerId) return
      cancelPress()
      const h = lifted.current
      if (!h) return
      // A drop where it started is not a change and writes nothing.
      const order = liveRef.current
      if (order && !sameOrder(order, idsRef.current)) onReorderRef.current(order)
      release(h)
    }

    function putBack(h: Lifted) {
      cancelPress()
      const order = liveRef.current
      if (order && !sameOrder(order, idsRef.current)) {
        // The others go home while the item is still lifted, so it lands from
        // under the pointer rather than jumping to its old slot first.
        slideFrom.current = painted()
        flushSync(() => setLiveOrder([...idsRef.current]))
      }
      release(h)
    }

    function onCancel(e: PointerEvent) {
      if (e.pointerId !== pressed.current?.pointerId) return
      const h = lifted.current
      if (h) putBack(h)
      else cancelPress()
    }

    function onEscape(e: KeyboardEvent) {
      const h = lifted.current
      if (e.key === 'Escape' && h) putBack(h)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    document.addEventListener('keydown', onEscape)
    return () => {
      cancelPress()
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      document.removeEventListener('keydown', onEscape)
    }
    // The listeners read refs, so only these values need a re-bind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attr])

  // Items that arrive mid-drag are drawn after the live order rather than left
  // out until it ends.
  const order = liveOrder
    ? [...liveOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !liveOrder.includes(id))]
    : [...ids]

  function look(id: string): string {
    if (id === held) return LIFT
    if (id === settling) return SETTLE
    return held !== null || settling !== null ? SHIFT : ''
  }

  function endsDrag(e: { detail: number }): boolean {
    const ends = swallow.current && e.detail > 0
    swallow.current = false
    return ends
  }

  return { order, held, press, look, endsDrag }
}
