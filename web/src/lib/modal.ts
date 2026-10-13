import { useEffect, useRef, type RefObject } from 'react'

const CONTROLS = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'

/** The controls Tab reaches inside a window, in order. */
export function tabStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CONTROLS)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(':disabled, [type="hidden"]') &&
      !el.closest('[inert]') &&
      // Safari before 17.4 has no checkVisibility, and jsdom neither.
      (typeof el.checkVisibility !== 'function' || el.checkVisibility()),
  )
}

/** Whether the element is the last of its kind on the page, the window in front. */
function inFront(card: HTMLElement, selector: string): boolean {
  const windows = document.querySelectorAll(selector)
  return windows[windows.length - 1] === card
}

/**
 * Holds the keyboard inside an open window: focus moves in when it opens, Tab
 * and Shift+Tab go round its controls, Escape closes the window in front, and
 * focus goes back to the control that opened it when it closes.
 *
 * The opener is read while the window renders, since by the time an effect
 * runs a confirmation's autofocus has already moved the focus into it.
 * `returnTo` names it outright where the opener is no longer there to take it.
 */
export function useModal(
  card: RefObject<HTMLElement | null>,
  onClose: () => void,
  {
    open = true,
    focus = 'card',
    returnTo,
  }: {
    open?: boolean
    /** Where focus goes on opening: the card itself, its first control, or wherever autofocus put it. */
    focus?: 'card' | 'first' | 'keep'
    returnTo?: RefObject<HTMLElement | null>
  } = {},
) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  const opener = useRef<Element | null>(null)
  if (!open) opener.current = null
  else opener.current ??= document.activeElement

  useEffect(() => {
    const box = card.current
    if (!open || !box) return
    const back = returnTo?.current ?? opener.current
    if (focus === 'card') box.focus()
    else if (focus === 'first') tabStops(box)[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      // An open dropdown or menu inside the window takes these keys for itself.
      if (document.querySelector('[role="listbox"], [role="menu"]')) return
      if (e.key === 'Escape') {
        // A popover drawn as a dialog inside the window closes first.
        if (!inFront(box, '[role="dialog"]')) return
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab' || !inFront(box, '[aria-modal="true"]')) return
      const stops = tabStops(box)
      const first = stops[0]
      const last = stops[stops.length - 1]
      const at = document.activeElement
      if (!first || !last) {
        e.preventDefault()
        box.focus()
      } else if (!at || !box.contains(at)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (at === first || at === box)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && at === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (back instanceof HTMLElement) back.focus()
    }
    // Bound once per opening; the card and the opener are read as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
