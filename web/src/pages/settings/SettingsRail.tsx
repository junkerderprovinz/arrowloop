import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

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
const NARROW = '(max-width: 1023px)'

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const follow = () => setNarrow(query.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])
  return narrow
}

/**
 * The settings pages as a column of tiles beside the content: the tab selector
 * turned on its side. Every tile is a link to its page's address, so Ctrl-click
 * opens it beside the current one. The column is one tab stop; the arrow keys
 * move the focus and Enter opens, since every opening is a history entry.
 *
 * The order is the person's: a long press on a touch screen, or a drag with
 * the mouse, lifts a tile and the column wiggles while it is carried. Alt and
 * an arrow key move the focused tile for somebody without a pointer.
 */
export function SettingsRail({ tiles, active }: { tiles: Tile[]; active: TileId }) {
  const { t } = useT()
  useRainbow()
  const chosen = useLabelMode('tabs')
  const mode = useNarrow() ? 'glyph' : chosen
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
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      move(e.key === 'ArrowUp' ? -1 : 1)
      return
    }
    const last = tiles.length - 1
    const next =
      e.key === 'ArrowDown' ? Math.min(last, focus + 1)
      : e.key === 'ArrowUp' ? Math.max(0, focus - 1)
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
      <span className="sr-only" aria-live="polite">
        {moved}
      </span>
    </>
  )
}
