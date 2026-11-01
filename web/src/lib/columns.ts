import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'

// The columns of a list that somebody can move and widen, as KnightLoader's
// lists have them. The head and every row read one track list through
// --list-cols on the element around them, so a drag repaints the list by
// touching that element instead of re-rendering its rows.

export interface ColumnDef {
  id: string
  /** The starting width in pixels; the column without one takes what the others leave. */
  width?: number
  /** How narrow a drag may make it. */
  min?: number
  /** A column that keeps its width, such as the side arrow. */
  fixed?: boolean
}

export interface ColumnLayout {
  order: string[]
  widths: Record<string, number>
}

/** The narrowest the flexible column gets before the list scrolls. */
const FLEX_MIN = 120
const MIN = 48

/** moveColumn puts `id` immediately before or after `target`. */
export function moveColumn(order: string[], id: string, target: string, after: boolean): string[] {
  if (id === target) return order
  const without = order.filter((x) => x !== id)
  const at = without.indexOf(target)
  if (at < 0) return order
  without.splice(after ? at + 1 : at, 0, id)
  return without
}

/** stepColumn moves `id` one place towards the start or the end, for the keyboard. */
export function stepColumn(order: string[], id: string, towardsEnd: boolean): string[] {
  const at = order.indexOf(id)
  const target = order[towardsEnd ? at + 1 : at - 1]
  return at < 0 || !target ? order : moveColumn(order, id, target, towardsEnd)
}

/**
 * The order a stored layout asks for, with a column this build lacks dropped
 * and one it adds seated at its built-in place, so an update neither
 * loses an arrangement nor leaves a hole in it.
 */
export function mergeOrder(defs: ColumnDef[], stored: string[] | undefined): string[] {
  const ids = defs.map((d) => d.id)
  const kept = (stored ?? []).filter((id) => ids.includes(id))
  for (const id of ids) {
    if (kept.includes(id)) continue
    const before = ids.slice(0, ids.indexOf(id)).reverse().find((x) => kept.includes(x))
    kept.splice(before ? kept.indexOf(before) + 1 : 0, 0, id)
  }
  return kept
}

export function minWidth(def: ColumnDef): number {
  return def.min ?? (def.width === undefined ? FLEX_MIN : def.fixed ? def.width : MIN)
}

/**
 * The track list for --list-cols. `drag` is a width still under the pointer,
 * drawn as if it were stored. The flexible column takes what the others leave
 * until somebody gives it a width, which then stays like any other.
 */
export function gridTemplate(defs: ColumnDef[], layout: ColumnLayout, drag?: { id: string; width: number }): string {
  const byId = new Map(defs.map((d) => [d.id, d]))
  return mergeOrder(defs, layout.order)
    .map((id) => {
      const def = byId.get(id)!
      const set = drag?.id === id ? drag.width : layout.widths[id]
      if (def.width === undefined && set === undefined) return `minmax(${minWidth(def)}px, 1fr)`
      return `${Math.max(minWidth(def), Math.round(set ?? def.width!))}px`
    })
    .join(' ')
}

function read(key: string): ColumnLayout {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (raw && typeof raw === 'object') {
      const { order, widths } = raw as Partial<ColumnLayout>
      return {
        order: Array.isArray(order) ? order.filter((x): x is string => typeof x === 'string') : [],
        widths: widths && typeof widths === 'object' ? (widths as Record<string, number>) : {},
      }
    }
  } catch {
    // Unreadable or blocked storage starts from the built-in layout.
  }
  return { order: [], widths: {} }
}

export type Columns = ReturnType<typeof useColumns>

/**
 * A list's columns, kept per list in this browser. `host` goes on the element
 * that holds the head and the rows, `style` sets the track list there, and
 * `cell(id)` places a cell in its column.
 */
export function useColumns(list: string, defs: ColumnDef[]) {
  const key = `arrowloop.columns.${list}`
  const [layout, setLayout] = useState<ColumnLayout>(() => read(key))
  const host = useRef<HTMLElement | null>(null)
  // The order while a head is dragged, so the columns move under the pointer
  // before the drop stores it.
  const [preview, setPreview] = useState<string[] | null>(null)
  const drag = useRef<{ id: string; startX: number; startWidth: number; width: number } | null>(null)

  const store = useCallback(
    (next: ColumnLayout) => {
      setLayout(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // The arrangement lasts until the page closes.
      }
    },
    [key],
  )

  const stored = useMemo(() => mergeOrder(defs, layout.order), [defs, layout.order])
  const order = preview ?? stored
  const shown = { ...layout, order }
  const template = gridTemplate(defs, shown)
  const def = (id: string) => defs.find((d) => d.id === id)

  return {
    order,
    style: { '--list-cols': template } as CSSProperties,
    host,
    cell: (id: string): CSSProperties => ({ order: order.indexOf(id) }),
    resizable: (id: string) => {
      const d = def(id)
      return !!d && !d.fixed
    },
    move: (id: string, target: string, after: boolean) => store({ ...layout, order: moveColumn(stored, id, target, after) }),
    /** Shows `id` before or after `target` while it is dragged; `drop` keeps that order and `cancel` takes it back. */
    preview: (id: string, target: string, after: boolean) => {
      const next = moveColumn(stored, id, target, after)
      setPreview((was) => (was?.join() === next.join() ? was : next))
    },
    drop: () => {
      if (preview) store({ ...layout, order: preview })
      setPreview(null)
    },
    cancel: () => setPreview(null),
    step: (id: string, towardsEnd: boolean) => store({ ...layout, order: stepColumn(order, id, towardsEnd) }),
    reset: (id: string) => {
      const widths = { ...layout.widths }
      delete widths[id]
      store({ ...layout, widths })
    },
    /** Follows a drag on a column's handle: the width under the pointer is painted straight onto the host, and stored when the drag ends. */
    resize: (id: string, phase: 'start' | 'move' | 'end', x: number, startWidth = 0) => {
      const d = def(id)
      if (!d) return
      if (phase === 'start') {
        drag.current = { id, startX: x, startWidth, width: startWidth }
        return
      }
      const now = drag.current
      if (!now || now.id !== id) return
      const rtl = document.documentElement.dir === 'rtl' ? -1 : 1
      now.width = Math.max(minWidth(d), Math.round(now.startWidth + (x - now.startX) * rtl))
      if (phase === 'move') {
        host.current?.style.setProperty('--list-cols', gridTemplate(defs, shown, now))
        return
      }
      drag.current = null
      store({ ...layout, widths: { ...layout.widths, [id]: now.width } })
    },
  }
}
