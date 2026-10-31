import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

import { IconAction } from './IconAction'
import { ContextMenu, type MenuItem } from './Menu'
import { Selector, type Option } from './Selector'
import { IconClose, IconExpand, IconMoveDown, IconMoveUp, IconSearch } from './glyphs'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { usePortalHue } from '../lib/glimstone/portalHue'
import { useT, type TranslationKey } from '../lib/i18n'
import { firstVisit } from '../lib/listTips'
import { placeMenu } from '../lib/menuPlace'

// GlimStone's list: the cards on top and the list below, with sorting,
// filtering, searching and the actions on many rows in the list itself. A
// head sorts on a click, its ▾ filters, typing in the list opens the search,
// and a right-click or a long press opens the menu.

export type SortDir = 'asc' | 'desc'
export type ListSort = { by: string; dir: SortDir }

export interface Head {
  id: string
  /** Empty for a column whose cells say enough, such as the side arrow. */
  label: string
  /** The width the rows give this column, so the head stands over it. */
  className?: string
  end?: boolean
  sorts?: boolean
  /** What the ▾ beside the name opens, and whether it narrows the list now. */
  filter?: { active: boolean; panel: ReactNode }
}

/** The order a click on a head asks for: the other way round on the head already sorting, else that head from the top. */
export function nextSort(sort: ListSort | undefined, by: string): ListSort {
  if (sort?.by === by) return { by, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
  return { by, dir: 'asc' }
}

/** How long a finger rests before its menu opens, and how far it may drift meanwhile. */
const LONG_PRESS_MS = 500
const PRESS_SLOP = 10

/**
 * The right-click menu of a list's rows and of its empty space, which a long
 * press opens on a touch screen. `on` gives the handlers to spread on an
 * element; a row's handlers win over the list's around it.
 */
export function useListMenu(label: string) {
  const [shown, setShown] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null)
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const held = useRef(false)
  const touch = useRef(false)

  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => endPress, [])

  function on(items: () => MenuItem[]) {
    return {
      onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
        // A field keeps the browser's own menu, for paste.
        if ((e.target as HTMLElement).closest('input, textarea')) return
        e.preventDefault()
        e.stopPropagation()
        // A finger's long press is handled below.
        if (touch.current) return
        const list = items()
        if (list.length > 0) setShown({ at: { x: e.clientX, y: e.clientY }, items: list })
      },
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        touch.current = e.pointerType === 'touch'
        if (!touch.current || press.current) return
        held.current = false
        const at = { x: e.clientX, y: e.clientY }
        press.current = {
          ...at,
          timer: window.setTimeout(() => {
            press.current = null
            const list = items()
            if (list.length === 0) return
            held.current = true
            setShown({ at, items: list })
          }, LONG_PRESS_MS),
        }
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const p = press.current
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP) endPress()
      },
      onPointerUp: endPress,
      onPointerCancel: endPress,
      // The press that opened the menu ends in a click, which must not also open the row.
      onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
        if (!held.current) return
        held.current = false
        e.preventDefault()
        e.stopPropagation()
      },
    }
  }

  const element = shown ? <ContextMenu label={label} items={shown.items} at={shown.at} onClose={() => setShown(null)} /> : null
  return { on, element }
}

/** The sentences of the hint line, for what this list can do. */
function tipText(t: ReturnType<typeof useT>['t'], heads: Head[], search: boolean, menu: boolean): string {
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches
  const parts: TranslationKey[] = []
  if (heads.some((h) => h.sorts)) parts.push('list.tip.sort')
  if (heads.some((h) => h.filter)) parts.push('list.tip.filter')
  if (touch) parts.push('list.tip.hold')
  else {
    if (search) parts.push('list.tip.search')
    if (menu) parts.push('list.tip.menu')
  }
  return parts.map((k) => t(k)).join(' ')
}

/**
 * The row of column names over a list. A head that sorts flips the order on a
 * click and carries the arrow of the order it is in; a head with a filter has
 * a ▾ that opens it, marked while the filter narrows the list. A line under
 * the row says all this on hover, by itself on the page's first visit, and
 * after a long press on a touch screen, where the press also opens the head's
 * choices.
 */
export function ListHead({
  heads,
  sort,
  onSort,
  page,
  onSearch,
  menu = false,
  className = '',
}: {
  heads: Head[]
  sort?: ListSort
  onSort?: (next: ListSort) => void
  /** The page's name for the first visit's hint, or none where another list on the page shows it. */
  page?: string
  /** Opens the list's search, which a long press offers on a touch screen. */
  onSearch?: () => void
  /** Whether a right-click on the list opens a menu, so the hint can say so. */
  menu?: boolean
  className?: string
}) {
  const { t } = useT()
  const [tipShown, setTipShown] = useState(() => (page ? firstVisit(page) : false))
  const [pressed, setPressed] = useState<{ head: Head; at: { x: number; y: number } } | null>(null)
  const [filterOpen, setFilterOpen] = useState<string | null>(null)
  const anchors = useRef(new Map<string, HTMLButtonElement>())
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const held = useRef(false)
  const tip = tipText(t, heads, !!onSearch, menu)

  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => endPress, [])

  const used = () => setTipShown(false)

  function sortBy(head: Head, dir?: SortDir) {
    if (!head.sorts || !onSort) return
    onSort(dir ? { by: head.id, dir } : nextSort(sort, head.id))
    used()
  }

  const pressedItems = (head: Head): MenuItem[] => [
    ...(head.sorts && onSort
      ? [
          { label: t('list.sortAsc'), labelKey: 'list.sortAsc' as const, onSelect: () => sortBy(head, 'asc') },
          { label: t('list.sortDesc'), labelKey: 'list.sortDesc' as const, onSelect: () => sortBy(head, 'desc') },
        ]
      : []),
    ...(head.filter ? [{ label: t('list.filter'), labelKey: 'list.filter' as const, onSelect: () => setFilterOpen(head.id) }] : []),
    ...(onSearch ? [{ label: t('list.search'), labelKey: 'list.search' as const, onSelect: onSearch }] : []),
  ]

  const openHead = filterOpen ? heads.find((h) => h.id === filterOpen) : undefined

  return (
    <div className={`group/head relative ${className}`}>
      <div role="row" className="flex items-center gap-x-3 border-b border-carbon-border/60 pb-1.5">
        {heads.map((head) => {
          const on = sort?.by === head.id
          const active = !!head.filter?.active
          const name = head.sorts ? (
            <button
              type="button"
              aria-sort={on ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              onPointerDown={(e) => {
                if (e.pointerType !== 'touch') return
                held.current = false
                const at = { x: e.clientX, y: e.clientY }
                press.current = {
                  ...at,
                  timer: window.setTimeout(() => {
                    held.current = true
                    press.current = null
                    setPressed({ head, at })
                  }, LONG_PRESS_MS),
                }
              }}
              onPointerMove={(e) => {
                const p = press.current
                if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP) endPress()
              }}
              onPointerUp={endPress}
              onPointerCancel={endPress}
              onContextMenu={(e) => {
                if (held.current) e.preventDefault()
              }}
              onClick={() => {
                if (held.current) {
                  held.current = false
                  return
                }
                sortBy(head)
              }}
              className={`glim-btn-bare flex min-w-0 items-center gap-1 truncate text-meta font-medium transition-colors ${
                on || active ? 'text-carbon-text' : 'text-carbon-textMuted'
              }`}
            >
              <span className="truncate">{head.label}</span>
              {on && (sort?.dir === 'asc' ? <IconMoveUp width={11} height={11} /> : <IconMoveDown width={11} height={11} />)}
            </button>
          ) : (
            <span
              onPointerDown={(e) => {
                if (e.pointerType !== 'touch' || (!head.filter && !onSearch)) return
                const at = { x: e.clientX, y: e.clientY }
                press.current = { ...at, timer: window.setTimeout(() => setPressed({ head, at }), LONG_PRESS_MS) }
              }}
              onPointerUp={endPress}
              onPointerCancel={endPress}
              className={`min-w-0 truncate text-meta font-medium ${active ? 'text-carbon-text' : 'text-carbon-textMuted'}`}
            >
              {head.label}
            </span>
          )
          return (
            <div
              key={head.id}
              role="columnheader"
              className={`flex min-w-0 items-center gap-0.5 ${head.end ? 'justify-end' : ''} ${head.className ?? ''}`}
            >
              {head.label && name}
              {head.filter && (
                <button
                  type="button"
                  ref={(el) => {
                    if (el) anchors.current.set(head.id, el)
                    else anchors.current.delete(head.id)
                  }}
                  aria-label={t('list.filterBy', { name: head.label })}
                  data-tip={t('list.filterBy', { name: head.label })}
                  aria-haspopup="dialog"
                  aria-expanded={filterOpen === head.id}
                  onClick={() => {
                    setFilterOpen((was) => (was === head.id ? null : head.id))
                    used()
                  }}
                  className={`glim-btn-bare relative grid h-5 w-5 shrink-0 place-items-center rounded-control ${
                    active ? 'text-carbon-text' : 'text-carbon-textMuted'
                  }`}
                >
                  <IconExpand width={11} height={11} />
                  {/* A narrowed column carries the accent, so a filtered list never passes for the whole one. */}
                  {active && <span aria-hidden className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent" />}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {tipShown || pressed ? (
        <div role="note" className="flex items-center gap-2 py-1.5 text-meta text-carbon-textSub">
          <span className="min-w-0 flex-1">{tip}</span>
          {tipShown && (
            <button
              type="button"
              aria-label={t('common.close')}
              data-tip={t('common.close')}
              onClick={used}
              className="glim-btn-bare grid h-5 w-5 shrink-0 place-items-center rounded-control"
            >
              <IconClose width={10} height={10} />
            </button>
          )}
        </div>
      ) : (
        // Under the pointer only; a touch screen has the long press instead.
        <div
          role="note"
          className="pointer-events-none absolute start-0 top-full z-10 mt-1 hidden rounded-control bg-carbon-surface2 px-2.5 py-1 text-meta text-carbon-textSub shadow-sm [@media(hover:hover)]:group-hover/head:block"
        >
          {tip}
        </div>
      )}

      {openHead?.filter && (
        <FilterPanel
          label={t('list.filterBy', { name: openHead.label })}
          anchor={{ current: anchors.current.get(openHead.id) ?? null }}
          onClose={() => setFilterOpen(null)}
        >
          {openHead.filter.panel}
        </FilterPanel>
      )}

      {pressed && pressedItems(pressed.head).length > 0 && (
        <ContextMenu label={pressed.head.label} items={pressedItems(pressed.head)} at={pressed.at} onClose={() => setPressed(null)} />
      )}
    </div>
  )
}

/** What a head's ▾ opens, under the ▾, until a press outside it or Escape. */
function FilterPanel({
  label,
  anchor,
  onClose,
  children,
}: {
  label: string
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const hue = usePortalHue(true, anchor)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect()
    const el = panel.current
    if (!box || !el) return
    setAt(
      placeMenu(
        box,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        document.documentElement.dir === 'rtl',
      ),
    )
  }, [anchor])

  useEffect(() => {
    const press = (e: MouseEvent) => {
      const target = e.target as Node
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return
      // A choice inside the panel may open a list of its own on the body.
      if ((target as HTMLElement).closest?.('[role="listbox"], [role="dialog"]')) return
      close.current()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close.current()
      anchor.current?.focus()
    }
    document.addEventListener('mousedown', press)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', press)
      document.removeEventListener('keydown', key)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className={`fixed z-50 flex w-max min-w-[16rem] max-w-[min(90vw,26rem)] flex-col gap-4 rounded-card bg-carbon-surface p-4 shadow-xl glim-fade${
        hue.className ? ` ${hue.className}` : ''
      }`}
      style={{ left: at?.left ?? -9999, top: at?.top ?? -9999, ...(hue.style ?? {}) } as CSSProperties}
    >
      {children}
    </div>,
    document.body,
  )
}

/** One choice inside a filter: its caption and the options as chips. */
export function FilterChoice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Option<T>[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-meta text-carbon-textMuted">{label}</span>
      <Selector<T> label={label} options={options} value={value} onChange={onChange} scale="small" variant="chip" />
    </div>
  )
}

/** Whether a key press is a character somebody types and nothing else wants. */
function startsTyping(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return false
  const at = e.target
  if (!(at instanceof HTMLElement)) return true
  return !at.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], [role="listbox"]')
}

/**
 * The list's search, without a button of its own. It floats at the top of the
 * list once somebody types there or presses Ctrl+F, and stays in view while
 * the page scrolls. Escape empties and closes it; a field that holds text
 * stays, so a forgotten search cannot hide.
 *
 * `area` is the element whose key presses open it, a typed character starting
 * the search with that character. `open` is set to a function that opens it,
 * for a menu that offers the search.
 */
export function ListSearch({
  value,
  onChange,
  placeholder,
  area,
  open: opener,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  area: RefObject<HTMLElement | null>
  open?: RefObject<(() => void) | null>
}) {
  const { t } = useT()
  const [opened, setOpened] = useState(false)
  // Bumped on every request for the caret, which the field takes once drawn.
  const [asked, setAsked] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const latest = useRef(value)
  latest.current = value
  const change = useRef(onChange)
  change.current = onChange

  useEffect(() => {
    const show = () => {
      setOpened(true)
      setAsked((n) => n + 1)
    }
    if (opener) opener.current = show
    const el = area.current
    const onType = (e: KeyboardEvent) => {
      if (!startsTyping(e)) return
      e.preventDefault()
      change.current(latest.current + e.key)
      show()
    }
    const onFind = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      // A window over the page has its own keys.
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      show()
    }
    el?.addEventListener('keydown', onType)
    document.addEventListener('keydown', onFind)
    return () => {
      el?.removeEventListener('keydown', onType)
      document.removeEventListener('keydown', onFind)
      if (opener) opener.current = null
    }
  }, [area, opener])

  useEffect(() => {
    if (asked > 0) field.current?.focus()
  }, [asked])

  const close = () => {
    onChange('')
    setOpened(false)
    area.current?.focus()
  }

  if (!opened && value === '') return null
  return (
    // A box of no height that sticks to the top of the window while the list
    // scrolls under it, so the search floats over the rows and moves none.
    <div className="pointer-events-none sticky top-3 z-20 h-0">
      <div role="search" className="glim-fade pointer-events-auto absolute end-0 top-0 flex items-center gap-2 rounded-card bg-carbon-surface p-2 shadow-xl">
        <label className="flex h-[var(--btn-h)] w-72 max-w-[calc(100vw-6rem)] items-center gap-2 rounded-control bg-carbon-surface2 px-3">
          <span className="shrink-0 text-carbon-textMuted" aria-hidden>
            <IconSearch />
          </span>
          <input
            ref={field}
            type="search"
            aria-label={t('list.search')}
            placeholder={placeholder}
            value={value}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              // Escape closes the search before any window around it.
              e.stopPropagation()
              e.preventDefault()
              close()
            }}
            className="min-w-0 flex-1 bg-transparent text-body text-carbon-text outline-none [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        <IconAction title={t('common.close')} labelKey="common.close" onClick={close} />
      </div>
    </div>
  )
}

/**
 * What narrows a list, in its totals card: the filters and the search in
 * words, and the one click that shows everything again. Nothing while the
 * list is whole.
 */
export function Narrowed({ what, onClear }: { what: string[]; onClear: () => void }) {
  const { t } = useT()
  if (what.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-subline">
      <Badge tone="active">{t('list.filtered')}</Badge>
      <span className="min-w-0 flex-1 text-carbon-textSub [overflow-wrap:anywhere]">{what.join(' · ')}</span>
      <Button label={t('list.showAll')} labelKey="list.showAll" tone="subtle" onClick={onClear} />
    </div>
  )
}
