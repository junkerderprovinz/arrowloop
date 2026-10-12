import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '../lib/glimstone/Button'
import { DropdownListbox } from '../lib/glimstone/DropdownListbox'
import { usePortalHue } from '../lib/glimstone/portalHue'
import { placeMenu } from '../lib/menuPlace'
import { useNarrow } from '../lib/narrow'
import { useT } from '../lib/i18n'
import { IconFilter, IconSearch, IconSort } from './glyphs'
import { Selector, type Option } from './Selector'

/**
 * The bar above a list's card: what it leaves out, how it is ordered and the
 * search, three buttons of the same weight at the end of the row. Anything a
 * page puts first, such as a view selector, stands at the start.
 */
export function ListBar({ start, newId, children }: { start?: ReactNode; newId?: string; children: ReactNode }) {
  return (
    <div data-new={newId} className="flex flex-wrap items-center gap-2">
      {start}
      <div className="ms-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  )
}

/**
 * The filter button and the panel it opens, which holds the page's choices.
 * A dot on the button says a choice is set, so a list that a remembered
 * filter shortened says why.
 */
export function FilterButton({ active, children }: { active: boolean; children: ReactNode }) {
  const { t } = useT()
  const narrow = useNarrow()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const hue = usePortalHue(open, trigger)

  useEffect(() => {
    trigger.current?.setAttribute('aria-haspopup', 'dialog')
    trigger.current?.setAttribute('aria-expanded', String(open))
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const box = trigger.current?.getBoundingClientRect()
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
  }, [open])

  useEffect(() => {
    if (!open) return
    const press = (e: MouseEvent) => {
      const target = e.target as Node
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', press)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', press)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <span className="relative inline-flex">
      <Button
        ref={trigger}
        label={t('list.filter')}
        labelKey="list.filter"
        glyph={<IconFilter />}
        tone="subtle"
        className={narrow ? 'glim-glyph-only' : ''}
        onClick={() => setOpen((was) => !was)}
      />
      {active && (
        <span aria-hidden className="pointer-events-none absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-carbon-background" />
      )}
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={t('list.filter')}
            className={`fixed z-50 flex w-max min-w-[16rem] max-w-[min(90vw,26rem)] flex-col gap-4 rounded-card bg-carbon-surface p-4 shadow-xl glim-fade${
              hue.className ? ` ${hue.className}` : ''
            }`}
            style={{ left: at?.left ?? -9999, top: at?.top ?? -9999, ...(hue.style ?? {}) } as CSSProperties}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  )
}

/** One choice inside the filter panel: its caption and the options as chips. */
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

/** The order of the list, named by the order it is in, both ways round for every field. */
export function SortButton<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  const { t } = useT()
  const narrow = useNarrow()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value) ?? options[0]

  return (
    <>
      <Button
        ref={trigger}
        label={current?.label ?? t('list.sort')}
        labelKey="list.sort"
        glyph={<IconSort />}
        tone="subtle"
        title={t('list.sort')}
        className={narrow ? 'glim-glyph-only' : ''}
        onClick={() => setOpen((was) => !was)}
      />
      <DropdownListbox open={open} onClose={() => setOpen(false)} triggerRef={trigger} label={t('list.sort')}>
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`flex w-full items-center px-3 py-2 text-start text-body transition-colors ${
                on ? 'bg-carbon-surface3 text-carbon-text' : 'text-carbon-textSub hover:bg-carbon-hover hover:text-carbon-text'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </DropdownListbox>
    </>
  )
}

// How long an emptied field waits before it folds back. A click on the button
// next to it blurs the field first, and folding at once would move that button
// from under the pointer.
const FOLD_DELAY_MS = 250

/**
 * A search that waits as a button and opens into a field. It stays open while
 * it holds a query, and Escape clears it.
 */
export function SearchFold({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  const { t } = useT()
  const narrow = useNarrow()
  const [open, setOpen] = useState(false)
  const fold = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(fold.current), [])

  if (!open && value === '') {
    return (
      <Button
        label={t('list.search')}
        labelKey="list.search"
        glyph={<IconSearch />}
        tone="subtle"
        className={narrow ? 'glim-glyph-only' : ''}
        onClick={() => setOpen(true)}
      />
    )
  }

  return (
    <label className="flex h-[var(--btn-h)] w-64 max-w-full items-center gap-2 rounded-control bg-carbon-surface2 px-3">
      <span className="shrink-0 text-carbon-textMuted" aria-hidden>
        <IconSearch />
      </span>
      <input
        type="search"
        aria-label={t('list.search')}
        placeholder={placeholder}
        value={value}
        autoFocus={open}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          window.clearTimeout(fold.current)
          setOpen(true)
        }}
        onBlur={() => {
          fold.current = window.setTimeout(() => setOpen(false), FOLD_DELAY_MS)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || value === '') return
          e.stopPropagation()
          onChange('')
        }}
        className="min-w-0 flex-1 bg-transparent text-body text-carbon-text outline-none [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  )
}
