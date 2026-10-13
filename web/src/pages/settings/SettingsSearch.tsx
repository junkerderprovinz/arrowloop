// The search over all of Settings: the tile names, the card titles, the name of
// each setting and the text behind its (i), in the reader's language. A result
// opens its tile and marks the card or row there; it does not filter the page.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { IconClose, IconSearch } from '../../components/glyphs'
import { fold } from '../../lib/fold'
import { InfoBubble } from '../../lib/glimstone/InfoBubble'
import { useT, type TranslationKey } from '../../lib/i18n'
import { navigate } from '../../lib/router'
import type { TileId } from '../../lib/routes'
import { useRevealOnScrollUp } from './revealOnScrollUp'
import { SETTINGS_INDEX } from './searchIndex'
import { FORMER_NAMES, type Tile } from './tiles'

/** Where a result leads on its tile: the card, and the row in it. */
export interface SearchJump {
  card?: string
  row?: string
}

interface Item {
  id: string
  tile: TileId
  tileName: string
  name: string
  cardName?: string
  /** A name the settings carried in an earlier version. */
  former?: boolean
  /** Lower tiers sort first where the match is equally good. */
  tier: number
  foldedName: string
  foldedProse: string
}

/** How many results are drawn; the count read out covers all of them. */
const SHOWN = 40
/** Added to a match found only in explanations, so every name match ranks first. */
const PROSE = 1000

export function buildItems(t: (k: TranslationKey) => string, tiles: Tile[]): Item[] {
  const items: Item[] = []
  for (const tile of tiles) {
    const tileName = t(tile.labelKey)
    const add = (item: Omit<Item, 'tile' | 'tileName' | 'foldedName'>) =>
      items.push({ ...item, tile: tile.id, tileName, foldedName: fold(item.name) })
    add({ id: `tile:${tile.id}`, name: tileName, tier: 0, foldedProse: '' })
    for (const card of SETTINGS_INDEX[tile.id]) {
      const title = t(card.title)
      const prose = [card.hint, ...(card.body ?? [])].map((k) => (k ? t(k) : '')).join(' ')
      add({ id: `card:${tile.id}:${title}`, name: title, tier: 1, foldedProse: fold(prose) })
      for (const row of card.rows) {
        add({
          id: `row:${tile.id}:${title}:${row.key}`,
          name: t(row.key),
          cardName: title,
          tier: 2,
          foldedProse: row.hint ? fold(t(row.hint)) : '',
        })
      }
    }
  }
  for (const f of FORMER_NAMES) {
    const tile = tiles.find((x) => x.id === f.tile)
    if (!tile) continue
    const name = t(f.labelKey)
    items.push({
      id: `former:${f.labelKey}`,
      tile: tile.id,
      tileName: t(tile.labelKey),
      name,
      cardName: f.card && t(f.card),
      former: true,
      tier: 0,
      foldedName: fold(name),
      foldedProse: '',
    })
  }
  return items
}

/**
 * Ranks every item whose name holds all the words, a word at the start of the
 * name ranking higher, and after them the items whose explanation holds them.
 */
export function search<T extends { foldedName: string; foldedProse: string; tier: number }>(
  items: T[],
  query: string,
): { item: T; inHint: boolean }[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hits: { item: T; score: number; inHint: boolean }[] = []
  items.forEach((item, order) => {
    const inName = words.every((w) => item.foldedName.includes(w))
    const inHint = !inName && words.every((w) => item.foldedName.includes(w) || item.foldedProse.includes(w))
    if (!inName && !inHint) return
    const early = words.filter((w) => item.foldedName.startsWith(w) || item.foldedName.includes(` ${w}`)).length
    hits.push({ item, inHint, score: (inHint ? PROSE : 0) - early * 10 + item.tier + order / 1e6 })
  })
  return hits.sort((a, b) => a.score - b.score)
}

/** The jump a result asked for, taken by the tile once it has drawn. */
let pending: SearchJump | null = null
const asked = new Set<() => void>()

export function takeJump(): SearchJump | null {
  const jump = pending
  pending = null
  return jump
}

/**
 * Calls back when a result asks for a jump. A jump on the tile already open
 * changes no address, so the tile would not hear of it otherwise.
 */
export function onJump(listener: () => void): () => void {
  asked.add(listener)
  return () => asked.delete(listener)
}

/** Opens a tile and marks the card or row there, the way a search result does. */
export function openSetting(tile: TileId, jump: SearchJump | null) {
  pending = jump
  navigate(`/settings/${tile}`)
  for (const listener of asked) listener()
}

export function SettingsSearch({ tiles, tile }: { tiles: Tile[]; tile: TileId }) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const listId = useId()
  // Kept while in use, so a wheel tick cannot take it from somebody typing.
  const inUse = open || query !== '' || (typeof document !== 'undefined' && document.activeElement === field.current)
  const { revealed, barRef, show, hide } = useRevealOnScrollUp(tile, inUse)
  const [summoned, setSummoned] = useState(0)

  // A slash outside a field and Ctrl+K anywhere bring the search up with the
  // cursor in it.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const el = e.target instanceof HTMLElement ? e.target : null
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing
      const palette = e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
      // A window over the page has its own keys.
      if ((!slash && !palette) || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      show()
      setSummoned((n) => n + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [show])

  useEffect(() => {
    if (summoned > 0) field.current?.focus()
  }, [summoned, revealed])

  const items = useMemo(() => buildItems(t, tiles), [t, tiles])
  const hits = useMemo(() => search(items, query), [items, query])
  const shown = hits.slice(0, SHOWN)
  const showList = open && query.trim() !== ''

  function pick({ item }: { item: Item }) {
    setQuery('')
    setOpen(false)
    field.current?.blur()
    openSetting(
      item.tile,
      item.tier === 1 ? { card: item.name } : item.tier === 2 ? { card: item.cardName, row: item.name } : item.cardName ? { card: item.cardName } : null,
    )
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Escape steps back one thing at a time: the list, then the text, then the
    // bar itself, which nobody should have to scroll to get rid of.
    if (e.key === 'Escape') {
      e.preventDefault()
      if (showList) setOpen(false)
      else if (query) setQuery('')
      else hide()
      return
    }
    if (!showList || shown.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a + step + shown.length) % shown.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = shown[Math.min(active, shown.length - 1)]
      if (hit) pick(hit)
    }
  }

  // Results stay grouped by tile, in rank order within each.
  const groups: { tile: TileId; name: string; hits: { hit: (typeof shown)[number]; index: number }[] }[] = []
  shown.forEach((hit, index) => {
    let group = groups.find((g) => g.tile === hit.item.tile)
    if (!group) {
      group = { tile: hit.item.tile, name: hit.item.tileName, hits: [] }
      groups.push(group)
    }
    group.hits.push({ hit, index })
  })

  // Not rendered until summoned, so it is out of the tab order and hidden from
  // screen readers.
  if (!revealed) return null

  return (
    <div
      ref={barRef}
      data-settings-search
      data-new="settings-search"
      className="relative mb-6 w-full"
    >
      <div
        className="flex h-[var(--btn-h)] items-center gap-2 bg-carbon-surface2 ps-3 pe-1"
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        <span className="shrink-0 text-carbon-textMuted">
          <IconSearch />
        </span>
        <input
          ref={field}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && shown.length > 0 ? `${listId}-${Math.min(active, shown.length - 1)}` : undefined}
          aria-label={t('settings.searchLabel')}
          placeholder={t('settings.searchLabel')}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-body text-carbon-text outline-none placeholder:text-carbon-textMuted [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label={t('settings.searchClear')}
            data-tip={t('settings.searchClear')}
            onClick={() => {
              setQuery('')
              field.current?.focus()
            }}
            className="flex h-8 w-8 items-center justify-center rounded-control text-carbon-textSub hover:bg-carbon-hover"
          >
            <IconClose />
          </button>
        )}
        <span className="pe-2">
          <InfoBubble tip={t('settings.searchHint')} />
        </span>
      </div>
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label={t('settings.searchResults')}
          // A press on a result would blur the field and close the list first.
          onMouseDown={(e) => e.preventDefault()}
          className="glim-fade absolute inset-x-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto rounded-card bg-carbon-surface py-1.5"
          style={{ boxShadow: 'var(--elevation)' }}
        >
          {shown.length === 0 && (
            <p className="px-4 py-6 text-center text-subline text-carbon-textMuted">{t('settings.searchNone')}</p>
          )}
          {groups.map((g) => (
            <div key={g.tile} role="group" aria-label={g.name} className="py-1">
              <div className="glim-eyebrow px-4 pb-1 font-semibold">{g.name}</div>
              {g.hits.map(({ hit, index }) => (
                <div
                  key={hit.item.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(hit)}
                  className={`flex cursor-pointer flex-col gap-0.5 px-4 py-2 text-body ${
                    index === active ? 'bg-carbon-hover text-carbon-text' : 'text-carbon-textSub'
                  }`}
                >
                  <span className="truncate">{hit.item.name}</span>
                  {(hit.item.cardName || hit.inHint || hit.item.tier === 0) && (
                    <span className="flex min-w-0 gap-2 text-meta text-carbon-textMuted">
                      <span className="truncate">
                        {hit.item.former
                          ? t('settings.searchFormer', { tile: hit.item.tileName })
                          : hit.item.tier === 0
                            ? t('settings.searchTile')
                            : hit.item.cardName}
                      </span>
                      {hit.inHint && <span className="shrink-0">{t('settings.searchInExplanation')}</span>}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <span aria-live="polite" className="sr-only">
        {showList ? t('settings.searchCount', { count: hits.length }) : ''}
      </span>
    </div>
  )
}

/**
 * The element a result leads to on the open tile: the row inside its card, or
 * the card itself when the row is not drawn, such as a switch that only shows
 * while another one is on.
 */
export function jumpTarget(root: ParentNode, jump: SearchJump): HTMLElement | null {
  const card = jump.card
    ? Array.from(root.querySelectorAll<HTMLElement>('.glim-notch-card')).find(
        (el) => el.querySelector('h2')?.textContent?.trim().startsWith(jump.card ?? ''),
      )
    : undefined
  const row = jump.row
    ? Array.from((card ?? root).querySelectorAll<HTMLElement>('[data-glim-label]')).find(
        (el) => el.dataset.glimLabel === jump.row,
      )
    : undefined
  return row ?? card ?? null
}

/** Rings the element for a moment, so the eye finds it after the scroll. */
export function markHit(el: HTMLElement) {
  el.classList.remove('glim-search-hit')
  // A second jump to the same element restarts the animation.
  void el.offsetWidth
  el.classList.add('glim-search-hit')
  const done = (e: AnimationEvent) => {
    if (e.animationName !== 'glim-search-hit') return
    el.classList.remove('glim-search-hit')
    el.removeEventListener('animationend', done)
  }
  el.addEventListener('animationend', done)
}
