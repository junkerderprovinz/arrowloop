import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The ids from the anchor to the clicked row, both included, in list order.
 * Without an anchor, or with one no longer in the list, only the clicked row.
 */
export function rangeIds(order: string[], anchor: string | null, id: string): string[] {
  const to = order.indexOf(id)
  const from = anchor === null ? -1 : order.indexOf(anchor)
  if (to === -1) return []
  if (from === -1) return [id]
  const [a, b] = from < to ? [from, to] : [to, from]
  return order.slice(a, b + 1)
}

type Mods = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }

export interface RowSelection {
  picked: ReadonlySet<string>
  /** At least one row is picked, so every row shows its mark. */
  selecting: boolean
  allPicked: boolean
  /**
   * Takes a click on a row and answers whether it picked rows. A plain click
   * while nothing is picked does not, and the row does its own thing instead.
   */
  click: (e: Mods, id: string) => boolean
  /** The mark itself, which a Shift press extends from the last pick. */
  mark: (id: string, range: boolean) => void
  setAll: (on: boolean) => void
  clear: () => void
}

function typing(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)
}

// A window or a menu above the list takes the keys itself.
function covered(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null
}

/**
 * Picks rows as a file manager does: Ctrl+click adds one, Shift+click the
 * range from the row picked last, Ctrl+A all of them, and Escape lets go.
 * `order` is the ids of the rows in view, in their order. A row that leaves
 * the view leaves the selection, so no action reaches what cannot be seen.
 */
export function useRowSelection(order: string[]): RowSelection {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const orderRef = useRef(order)
  orderRef.current = order

  const inView = order.join('\u0000')
  useEffect(() => {
    setPicked((prev) => {
      const kept = orderRef.current.filter((id) => prev.has(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }, [inView])

  const toggle = useCallback((id: string) => {
    anchor.current = id
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const extend = useCallback((id: string) => {
    const range = rangeIds(orderRef.current, anchor.current, id)
    anchor.current = id
    setPicked((prev) => new Set([...prev, ...range]))
  }, [])

  const setAll = useCallback((on: boolean) => setPicked(new Set(on ? orderRef.current : [])), [])

  const clear = useCallback(() => {
    anchor.current = null
    setPicked(new Set())
  }, [])

  const selecting = picked.size > 0

  const click = useCallback(
    (e: Mods, id: string) => {
      if (e.shiftKey) {
        extend(id)
        return true
      }
      if (!e.ctrlKey && !e.metaKey && !selecting) return false
      toggle(id)
      return true
    },
    [selecting, extend, toggle],
  )

  const mark = useCallback((id: string, range: boolean) => (range ? extend(id) : toggle(id)), [extend, toggle])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (typing() || covered()) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && orderRef.current.length > 0) {
        e.preventDefault()
        setAll(true)
      } else if (e.key === 'Escape' && selecting) {
        clear()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selecting, setAll, clear])

  const allPicked = order.length > 0 && order.every((id) => picked.has(id))
  return { picked, selecting, allPicked, click, mark, setAll, clear }
}
