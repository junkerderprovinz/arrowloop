import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { IconAction } from './IconAction'
import { Selector, type Option } from './Selector'
import { IconClose, IconExpand, IconMoveDown, IconMoveUp, IconSearch } from './glyphs'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { usePortalHue } from '../lib/glimstone/portalHue'
import { useT, type TranslationKey } from '../lib/i18n'
import { firstVisit } from '../lib/listTips'
import { BUBBLE_VIEWPORT_MARGIN } from '../lib/glimstone/bubblePosition'
import { placeUnderHead } from '../lib/menuPlace'

// GlimStone's list: the cards on top and the list below, with sorting,
// filtering and searching in the list itself. A head sorts on a click, its ▾
// filters, and typing in the list opens the search.

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

/** What a touch-only device matches: no key to type into the list and no pointer to hover with. */
const TOUCH_ONLY = '(hover: none) and (pointer: coarse)'

/** The event the magnifier sends up to the list's search, which listens on the list. */
const OPEN_SEARCH = 'list-search'

function useTouchOnly(): boolean {
  const [touch, setTouch] = useState(() => !!window.matchMedia?.(TOUCH_ONLY).matches)
  useEffect(() => {
    const query = window.matchMedia?.(TOUCH_ONLY)
    if (!query) return
    const follow = () => setTouch(query.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])
  return touch
}

/** How long a finger rests on the heads before the hint line shows, and how far it may drift meanwhile. */
const LONG_PRESS_MS = 500
const PRESS_SLOP = 10

/** The sentences of the hint line, for what this list can do. */
function tipText(t: ReturnType<typeof useT>['t'], heads: Head[], search: boolean, touch: boolean): string {
  const parts: TranslationKey[] = []
  if (heads.some((h) => h.sorts)) parts.push('list.tip.sort')
  if (heads.some((h) => h.filter)) parts.push('list.tip.filter')
  if (search) parts.push(touch ? 'list.tip.find' : 'list.tip.search')
  return parts.map((k) => t(k)).join(' ')
}

/**
 * The row of column names over a list. A head that sorts flips the order on a
 * click and carries the arrow of the order it is in; a head with a filter has
 * a ▾ that opens it, marked while the filter narrows the list. A line under
 * the row says all this on hover, by itself on the page's first visit, and
 * after a long press on a touch screen, where nothing hovers. A touch-only
 * device has no key to type into the list, so a magnifier at the end of the
 * row opens its search there.
 */
export function ListHead({
  heads,
  sort,
  onSort,
  page,
  search = false,
  className = '',
}: {
  heads: Head[]
  sort?: ListSort
  onSort?: (next: ListSort) => void
  /** The page's name for the first visit's hint, or none where another list on the page shows it. */
  page?: string
  /** Whether the list has a search, which the hint names and a touch-only device reaches by the magnifier. */
  search?: boolean
  className?: string
}) {
  const { t } = useT()
  const [tipShown, setTipShown] = useState(() => (page ? firstVisit(page) : false))
  const [pressed, setPressed] = useState(false)
  const [filterOpen, setFilterOpen] = useState<string | null>(null)
  const anchors = useRef(new Map<string, HTMLButtonElement>())
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const held = useRef(false)
  const touch = useTouchOnly()
  const tip = tipText(t, heads, search, touch)

  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => endPress, [])

  const used = () => {
    setTipShown(false)
    setPressed(false)
  }

  const openHead = filterOpen ? heads.find((h) => h.id === filterOpen) : undefined

  return (
    <div className={`group/head relative ${className}`}>
      <div
        role="row"
        onPointerDown={(e) => {
          if (e.pointerType !== 'touch') return
          held.current = false
          press.current = {
            x: e.clientX,
            y: e.clientY,
            timer: window.setTimeout(() => {
              held.current = true
              press.current = null
              setPressed(true)
            }, LONG_PRESS_MS),
          }
        }}
        onPointerMove={(e) => {
          const p = press.current
          if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP) endPress()
        }}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        // The press that showed the line ends in a click, which must not also sort.
        onClickCapture={(e) => {
          if (!held.current) return
          held.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
        className="flex items-center gap-x-3 border-b border-carbon-border/60 pb-1.5"
      >
        {heads.map((head) => {
          const on = sort?.by === head.id
          const active = !!head.filter?.active
          const name =
            head.sorts && onSort ? (
              <button
                type="button"
                aria-sort={on ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={() => {
                  onSort(nextSort(sort, head.id))
                  used()
                }}
                className={`glim-btn-bare flex min-w-0 items-center gap-1 truncate text-meta font-medium transition-colors ${
                  on || active ? 'text-carbon-text' : 'text-carbon-textMuted'
                }`}
              >
                <span className="truncate">{head.label}</span>
                {on && (sort?.dir === 'asc' ? <IconMoveUp width={11} height={11} /> : <IconMoveDown width={11} height={11} />)}
              </button>
            ) : (
              <span className={`min-w-0 truncate text-meta font-medium ${active ? 'text-carbon-text' : 'text-carbon-textMuted'}`}>
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
        {search && touch && (
          <button
            type="button"
            aria-label={t('list.search')}
            data-tip={t('list.search')}
            onClick={(e) => {
              e.currentTarget.dispatchEvent(new CustomEvent(OPEN_SEARCH, { bubbles: true }))
              used()
            }}
            className="glim-btn-bare ms-auto grid h-8 w-8 shrink-0 place-items-center rounded-control text-carbon-textMuted"
          >
            <IconSearch />
          </button>
        )}
      </div>

      {tipShown || pressed ? (
        <div role="note" className="flex items-center gap-2 py-1.5 text-meta text-carbon-textSub">
          <span className="min-w-0 flex-1">{tip}</span>
          <button
            type="button"
            aria-label={t('common.close')}
            data-tip={t('common.close')}
            onClick={used}
            className="glim-btn-bare grid h-5 w-5 shrink-0 place-items-center rounded-control"
          >
            <IconClose width={10} height={10} />
          </button>
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
  const [at, setAt] = useState<{ left: number; top: number; room: number } | null>(null)
  const hue = usePortalHue(true, anchor)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const trigger = anchor.current
    const el = panel.current
    if (!trigger || !el) return
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    const head = (trigger.closest('[role="columnheader"]') ?? trigger).getBoundingClientRect()
    const column = trigger.closest('main')?.getBoundingClientRect() ?? { left: 0, right: viewport.width }
    const place = placeUnderHead(
      head,
      trigger.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      column,
      viewport,
      document.documentElement.dir === 'rtl',
    )
    setAt({ ...place, room: column.right - column.left - 2 * BUBBLE_VIEWPORT_MARGIN })
  }, [anchor])

  useEffect(() => {
    const press = (e: MouseEvent) => {
      const target = e.target as Node
      if (panel.current?.contains(target)) return
      // A choice inside the panel may open a list of its own on the body.
      if ((target as HTMLElement).closest?.('[role="listbox"]')) return
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

  // The backdrop and the panel are siblings: a fixed panel inside the
  // backdrop would be placed against the backdrop, whose blur makes it the
  // containing block, rather than against the window.
  return createPortal(
    <>
      <div aria-hidden className="glim-modal-backdrop fixed inset-0 z-50" />
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        className={`fixed z-50 flex w-max min-w-[16rem] max-w-[min(90vw,26rem)] flex-col gap-4 rounded-card bg-carbon-surface p-4 shadow-2xl glim-fade${
          hue.className ? ` ${hue.className}` : ''
        }`}
        style={
          {
            left: at?.left ?? -9999,
            top: at?.top ?? -9999,
            maxWidth: at ? `min(26rem, ${at.room}px)` : undefined,
            ...(hue.style ?? {}),
          } as CSSProperties
        }
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

/** One choice inside a filter: its caption and the options as chips, side by side where they fit and under each other where not. */
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
      <Selector<T> label={label} options={options} value={value} onChange={onChange} scale="small" variant="chip" hug stack />
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
 * the search with that character, and where a head's magnifier asks for it.
 */
export function ListSearch({
  value,
  onChange,
  placeholder,
  area,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  area: RefObject<HTMLElement | null>
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
    el?.addEventListener(OPEN_SEARCH, show)
    document.addEventListener('keydown', onFind)
    return () => {
      el?.removeEventListener('keydown', onType)
      el?.removeEventListener(OPEN_SEARCH, show)
      document.removeEventListener('keydown', onFind)
    }
  }, [area])

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
