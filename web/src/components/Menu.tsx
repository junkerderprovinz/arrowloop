import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { IconAction } from './IconAction'
import { glyphFor } from '../lib/glyphFor'
import { BUBBLE_VIEWPORT_MARGIN } from '../lib/glimstone/bubblePosition'
import { usePortalHue } from '../lib/glimstone/portalHue'
import { useNarrow } from '../lib/narrow'
import { placeMenu } from '../lib/menuPlace'
import type { TranslationKey } from '../lib/i18n'

export type MenuItem = {
  label: string
  /** Picks the item's mark, the same way a button's key does. */
  labelKey: TranslationKey
  onSelect: () => void
  disabled?: boolean
}

/**
 * A button that opens a short list of further actions, the rare and the
 * dangerous ones a page keeps out of its way. The list is portalled to the
 * body, since a card clips what overflows it, and an outside press, Escape, a
 * scroll or a resize closes it, as the listbox does.
 */
export function Menu({
  label,
  labelKey,
  items,
  hueIndex,
  glyph,
  size,
}: {
  label: string
  labelKey: TranslationKey
  items: MenuItem[]
  hueIndex?: number
  glyph?: ReactNode
  /** The key height, for a menu standing among the page actions. */
  size?: 'default' | 'key'
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // Among the page actions it shows its glyph alone on a phone, as they do.
  const narrow = useNarrow()

  // Button draws the control and has no props for these, so they are set on
  // the element it renders.
  useEffect(() => {
    trigger.current?.setAttribute('aria-haspopup', 'menu')
    trigger.current?.setAttribute('aria-expanded', String(open))
  }, [open])

  return (
    <>
      <IconAction ref={trigger} title={label} labelKey={labelKey} hueIndex={hueIndex} size={size} className={size === 'key' && narrow ? 'glim-glyph-only' : ''} onClick={() => setOpen((was) => !was)}>
        {glyph}
      </IconAction>
      {open && <MenuPanel label={label} items={items} anchor={trigger} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * The same list at the pointer, for a right-click on a row. It offers what the
 * row's own buttons and its More menu offer.
 */
export function ContextMenu({
  label,
  items,
  at,
  onClose,
}: {
  label: string
  items: MenuItem[]
  at: { x: number; y: number }
  onClose: () => void
}) {
  return <MenuPanel label={label} items={items} point={at} onClose={onClose} />
}

function MenuPanel({
  label,
  items,
  anchor,
  point,
  onClose,
}: {
  label: string
  items: MenuItem[]
  anchor?: RefObject<HTMLElement | null>
  point?: { x: number; y: number }
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const hue = usePortalHue(true, anchor ?? panel)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const list = panel.current
    if (!list) return
    const size = { width: list.offsetWidth, height: list.offsetHeight }
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    const rtl = document.documentElement.dir === 'rtl'
    if (point) {
      const margin = BUBBLE_VIEWPORT_MARGIN
      const left = rtl ? point.x - size.width : point.x
      setAt({
        left: Math.max(margin, Math.min(left, viewport.width - size.width - margin)),
        top: Math.max(margin, Math.min(point.y, viewport.height - size.height - margin)),
      })
      return
    }
    const box = anchor?.current?.getBoundingClientRect()
    if (box) setAt(placeMenu(box, size, viewport, rtl))
  }, [anchor, point])

  // Focus moves in once the list stands where it belongs; focusing it while
  // parked off screen would scroll the page, and a scroll closes it.
  useLayoutEffect(() => {
    if (at) panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [at])

  useEffect(() => {
    const done = () => close.current()
    const press = (e: MouseEvent) => {
      const target = e.target as Node
      if (panel.current?.contains(target) || anchor?.current?.contains(target)) return
      done()
    }
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      done()
      anchor?.current?.focus()
    }
    document.addEventListener('mousedown', press)
    document.addEventListener('keydown', key, true)
    window.addEventListener('scroll', done, true)
    window.addEventListener('resize', done)
    return () => {
      document.removeEventListener('mousedown', press)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('scroll', done, true)
      window.removeEventListener('resize', done)
    }
  }, [anchor])

  function move(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Tab') {
      onClose()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const all = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const now = all.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? all.length - 1
          : (now + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
    all[next]?.focus()
  }

  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      onKeyDown={move}
      onContextMenu={(e) => e.preventDefault()}
      className={`fixed z-50 flex min-w-48 flex-col rounded-card bg-carbon-surface py-1 shadow-xl glim-fade${
        hue.className ? ` ${hue.className}` : ''
      }`}
      style={{ left: at?.left ?? -9999, top: at?.top ?? -9999, ...(hue.style ?? {}) } as CSSProperties}
    >
      {items.map((item) => (
        <button
          key={item.labelKey}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-body text-carbon-textSub transition-colors hover:bg-carbon-hover hover:text-carbon-text focus-visible:bg-carbon-hover focus-visible:text-carbon-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex w-4 shrink-0 justify-center text-carbon-textMuted" aria-hidden>
            {glyphFor(item.labelKey)}
          </span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
