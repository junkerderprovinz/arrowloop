import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import { IconAction } from './IconAction'
import { glyphFor } from '../lib/glyphFor'
import { usePortalHue } from '../lib/glimstone/portalHue'
import { placeMenu } from '../lib/menuPlace'
import type { TranslationKey } from '../lib/i18n'

export type MenuItem = {
  label: string
  /** Picks the item's mark, the same way a button's key does. */
  labelKey: TranslationKey
  onSelect: () => void
}

/**
 * A button that opens a short list of further actions, for a card with more
 * of them than it has room for. The list is portalled to the body, since a
 * card clips what overflows it, and an outside press, Escape, a scroll or a
 * resize closes it, as the listbox does.
 */
export function Menu({
  label,
  labelKey,
  items,
  hueIndex,
}: {
  label: string
  labelKey: TranslationKey
  items: MenuItem[]
  hueIndex?: number
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const hue = usePortalHue(open, trigger)

  // Button draws the control and has no props for these, so they are set on
  // the element it renders.
  useEffect(() => {
    trigger.current?.setAttribute('aria-haspopup', 'menu')
    trigger.current?.setAttribute('aria-expanded', String(open))
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const box = trigger.current?.getBoundingClientRect()
    const list = panel.current
    if (!box || !list) return
    setAt(
      placeMenu(
        box,
        { width: list.offsetWidth, height: list.offsetHeight },
        { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        document.documentElement.dir === 'rtl',
      ),
    )
  }, [open])

  // Focus moves in once the list stands where it belongs; focusing it while
  // parked off screen would scroll the page, and a scroll closes it.
  useLayoutEffect(() => {
    if (at) panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [at])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const press = (e: MouseEvent) => {
      const target = e.target as Node
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return
      close()
    }
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', press)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', press)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function move(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const all = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const now = all.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? all.length - 1
          : (now + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
    all[next]?.focus()
  }

  return (
    <>
      <IconAction
        ref={trigger}
        title={label}
        labelKey={labelKey}
        hueIndex={hueIndex}
        onClick={() => setOpen((was) => !was)}
      />
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            onKeyDown={move}
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
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-xs text-carbon-textSub transition-colors hover:bg-carbon-hover hover:text-carbon-text focus-visible:bg-carbon-hover focus-visible:text-carbon-text"
              >
                <span className="flex w-4 shrink-0 justify-center text-carbon-textMuted" aria-hidden>
                  {glyphFor(item.labelKey)}
                </span>
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
