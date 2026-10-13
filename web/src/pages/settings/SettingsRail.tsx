import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'

import { useRainbow } from '../../components/Shell'
import { useReorder } from '../../lib/dragLift'
import { hueVars } from '../../lib/appearance'
import { hidesLabel } from '../../lib/controls'
import { useLabelMode } from '../../lib/glimstone/useLabelMode'
import { useT } from '../../lib/i18n'
import { Link, navigate } from '../../lib/router'
import type { TileId } from '../../lib/routes'
import { softHyphen } from '../../lib/softHyphen'
import { setTileOrder, type Tile } from './tiles'

/** Below this width the column shows its glyphs alone and leaves the room to the page. */
const GLYPHS_ONLY = '(max-width: 1023px)'

/**
 * Below this width even the column of glyphs, beside the full sidebar, leaves
 * the cards too little room for a row of buttons, so the tiles go above them.
 * At 768px the cards keep about 380px, what a phone gives them.
 */
export const ACROSS = '(max-width: 767px)'

export function useMatch(media: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(media).matches)
  useEffect(() => {
    const query = window.matchMedia(media)
    const follow = () => setMatches(query.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [media])
  return matches
}

/**
 * How many tiles share a row of the strip: all of them while the open tile's
 * name fits beside the other glyphs, otherwise as even a share as the rows
 * allow, so eight tiles go four and four rather than seven and one.
 *
 * @param named the open tile's width with its name on one line
 * @param glyph the width of a tile that shows its glyph alone
 */
export function stripPerRow(count: number, room: number, named: number, glyph: number, gap: number): number {
  for (let rows = 1; rows < count; rows++) {
    const perRow = Math.ceil(count / rows)
    if (named + (perRow - 1) * (glyph + gap) <= room) return perRow
  }
  return 1
}

/**
 * The settings pages as tiles: the tab selector turned on its side, a column
 * beside the content, or with `across` a strip of glyphs above it where the
 * window has no room for the column. Every tile is a link to its page's
 * address, so Ctrl-click opens it beside the current one. The tiles are one
 * tab stop; the arrow keys move the focus and Enter opens, since every opening
 * is a history entry.
 *
 * The order is the person's: a long press on a touch screen, or a drag with
 * the mouse, lifts a tile and the column wiggles while it is carried. Alt and
 * an arrow key move the focused tile for somebody without a pointer, in the
 * strip as well, which follows the same order.
 */
export function SettingsRail({ tiles, active, across = false }: { tiles: Tile[]; active: TileId; across?: boolean }) {
  const { t } = useT()
  useRainbow()
  const chosen = useLabelMode('tabs')
  const mode = useMatch(GLYPHS_ONLY) ? 'glyph' : chosen
  const [focus, setFocus] = useState(() => Math.max(0, tiles.findIndex((tile) => tile.id === active)))
  const [moved, setMoved] = useState('')
  const links = useRef<(HTMLAnchorElement | null)[]>([])
  const column = useRef<HTMLDivElement>(null)
  const drag = useReorder(
    tiles.map((tile) => tile.id),
    column,
    'data-tile',
    (ids) => setTileOrder(ids),
  )
  const shown = drag.order.map((id) => tiles.find((tile) => tile.id === id)!)

  useEffect(() => {
    const at = tiles.findIndex((tile) => tile.id === active)
    if (at >= 0) setFocus(at)
  }, [tiles, active])

  const move = (by: -1 | 1) => {
    const to = focus + by
    if (to < 0 || to >= tiles.length) return
    const ids = tiles.map((tile) => tile.id)
    ids.splice(to, 0, ...ids.splice(focus, 1))
    setTileOrder(ids)
    setFocus(to)
    setMoved(t('settings.tileMoved', { tile: t(tiles[focus].labelKey), place: to + 1 }))
    // The links are drawn again in the new order before the focus follows.
    requestAnimationFrame(() => links.current[to]?.focus())
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const rtl = document.documentElement.dir === 'rtl'
    const back = across ? (rtl ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp'
    const on = across ? (rtl ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown'
    if (e.altKey && (e.key === back || e.key === on)) {
      e.preventDefault()
      move(e.key === back ? -1 : 1)
      return
    }
    const last = tiles.length - 1
    const next =
      e.key === on ? Math.min(last, focus + 1)
      : e.key === back ? Math.max(0, focus - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next === null) {
      if (e.key === ' ') {
        e.preventDefault()
        navigate(`/settings/${tiles[focus]?.id}`)
      }
      return
    }
    e.preventDefault()
    setFocus(next)
    links.current[next]?.focus()
  }

  const live = (
    <span className="sr-only" aria-live="polite">
      {moved}
    </span>
  )

  if (across) {
    return (
      <>
        <Strip tiles={tiles} active={active} focus={focus} links={links} onKeyDown={onKeyDown} />
        {live}
      </>
    )
  }

  return (
    <>
      <div
        ref={column}
        role="tablist"
        aria-orientation="vertical"
        aria-label={t('settings.tiles')}
        data-new="settings-tiles"
        onKeyDown={onKeyDown}
        // No vertical padding, so the column starts and ends flush with the
        // sidebar. The 4px at the start are what the focus ring and a lifted
        // tile's shadow reach into. The column is the tiles' offsetParent, the
        // layout a drag measures in.
        className={`relative flex h-full shrink-0 flex-col gap-1 overflow-y-auto ps-1 pe-2 ${mode === 'glyph' ? 'w-13' : 'w-51'}${
          drag.held !== null ? ' glim-drag-armed' : ''
        }`}
      >
        {shown.map((tile, i) => {
          const selected = tile.id === active
          const label = t(tile.labelKey)
          const Icon = tile.icon
          const reactive = mode === 'reactive'
          return (
            <Link
              key={tile.id}
              ref={(el) => {
                links.current[i] = el
              }}
              to={`/settings/${tile.id}`}
              data-tile={tile.id}
              // A native link drag would cancel the pointer and end the reorder.
              draggable={false}
              onPointerDown={(e) => drag.press(e, tile.id)}
              onClick={(e) => {
                if (drag.endsDrag(e)) {
                  e.preventDefault()
                  e.stopPropagation()
                }
              }}
              role="tab"
              aria-selected={selected}
              aria-current={selected ? 'page' : undefined}
              tabIndex={i === focus ? 0 : -1}
              aria-label={hidesLabel(mode) ? label : undefined}
              title={mode === 'glyph' ? label : undefined}
              style={hueVars(i) as CSSProperties}
              // Grows from a zero basis above a 40px floor, so the tiles share
              // the column's height and a two-line name keeps its neighbours'
              // height; the caption under a reactive tile's glyph needs 48px.
              // It grows no taller than a tile of BombVault's column, whose
              // fourteen tiles share the same height with 4px between them, so
              // eight tiles leave the rest of the column empty below them.
              className={`glim-nav-row glim-hue glim-hue-icon group flex select-none [-webkit-touch-callout:none] max-h-[calc((100%_-_13_*_0.25rem)_/_14)] shrink-0 grow basis-0 items-center rounded-[var(--radius-pill)] text-[15px] leading-5 font-medium transition-colors ${
                reactive ? 'min-h-12 flex-col justify-center gap-0.5 px-1' : 'min-h-10 px-3'
              } ${mode === 'glyph' ? 'justify-center' : reactive ? '' : 'gap-3'} ${
                selected ? 'glim-active bg-accent text-accentContrast' : 'bg-carbon-surface2 text-carbon-textSub hover:bg-carbon-surface3 hover:text-carbon-text'
              } ${drag.look(tile.id)}`}
            >
              {mode !== 'text' && <Icon />}
              {mode === 'reactive' ? (
                <span className="max-h-0 overflow-hidden text-meta opacity-0 transition-all group-hover:max-h-5 group-hover:opacity-100 group-focus-visible:max-h-5 group-focus-visible:opacity-100">
                  {label}
                </span>
              ) : (
                mode !== 'glyph' && (
                  // A single long word, as some languages name a tile, has no
                  // space to wrap at, so it is hyphenated onto the second line
                  // rather than cut at the edge.
                  <span className="line-clamp-2 min-w-0 text-balance hyphens-auto [overflow-clip-margin:3px] [overflow-wrap:break-word]">
                    {softHyphen(label)}
                  </span>
                )
              )}
            </Link>
          )
        })}
      </div>
      {live}
    </>
  )
}

/**
 * The tiles as a strip above the content: the open tile shows its glyph and
 * its name, every other tile its glyph alone, with the name in its bubble and
 * as its accessible name. The strip wraps rather than scrolls, and a wrapped
 * strip shares the tiles evenly between its rows so no row ends in a gap.
 * The label setting does not reach it, since the column below the `lg`
 * breakpoint leaves it aside too.
 */
function Strip({
  tiles,
  active,
  focus,
  links,
  onKeyDown,
}: {
  tiles: Tile[]
  active: TileId
  focus: number
  links: RefObject<(HTMLAnchorElement | null)[]>
  onKeyDown: (e: KeyboardEvent) => void
}) {
  const { t, lang } = useT()
  const box = useRef<HTMLDivElement>(null)
  const [perRow, setPerRow] = useState(tiles.length)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const name = el.querySelector<HTMLElement>('[data-tile-name]')
      const open = name?.parentElement
      const glyphOnly = el.querySelector<HTMLElement>('[role="tab"][aria-selected="false"]')
      if (!name || !open || !glyphOnly) return
      const style = getComputedStyle(open)
      const glyph = open.firstElementChild?.getBoundingClientRect().width ?? 0
      // The name's scroll width is its one-line width, however much its row
      // lends or takes from the tile.
      const named =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + glyph + parseFloat(style.columnGap) + name.scrollWidth
      const gap = parseFloat(getComputedStyle(open.parentElement!).columnGap)
      setPerRow(stripPerRow(tiles.length, el.clientWidth, named, parseFloat(getComputedStyle(glyphOnly).minWidth), gap))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // A web font arriving late changes how wide the name is.
    void document.fonts?.ready.then(measure)
    return () => observer.disconnect()
  }, [tiles, active, lang])

  const rows: Tile[][] = []
  for (let at = 0; at < tiles.length; at += perRow) rows.push(tiles.slice(at, at + perRow))

  return (
    <div
      ref={box}
      role="tablist"
      aria-label={t('settings.tiles')}
      data-new="settings-tiles"
      onKeyDown={onKeyDown}
      className="flex shrink-0 flex-col gap-1"
    >
      {rows.map((row, r) => (
        <div key={r} role="none" className="flex gap-1">
          {row.map((tile, j) => {
            const i = r * perRow + j
            const selected = tile.id === active
            const label = t(tile.labelKey)
            const Icon = tile.icon
            return (
              <Link
                key={tile.id}
                ref={(el) => {
                  links.current[i] = el
                }}
                to={`/settings/${tile.id}`}
                data-tile={tile.id}
                role="tab"
                aria-selected={selected}
                aria-current={selected ? 'page' : undefined}
                tabIndex={i === focus ? 0 : -1}
                aria-label={selected ? undefined : label}
                data-tip={selected ? undefined : label}
                style={hueVars(i) as CSSProperties}
                className={`glim-nav-row glim-hue glim-hue-icon flex h-10 grow items-center justify-center rounded-[var(--radius-pill)] text-[15px] leading-5 font-medium transition-colors ${
                  selected
                    ? 'glim-active min-w-0 gap-2 bg-accent px-3 text-accentContrast'
                    : 'min-w-10 bg-carbon-surface2 text-carbon-textSub hover:bg-carbon-surface3 hover:text-carbon-text'
                }`}
              >
                <Icon />
                {selected && (
                  <span data-tile-name className="truncate">
                    {label}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </div>
  )
}
