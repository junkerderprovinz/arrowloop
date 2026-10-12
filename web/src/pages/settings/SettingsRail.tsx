import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

import { useRainbow } from '../../components/Shell'
import { hueVars } from '../../lib/appearance'
import { hidesLabel } from '../../lib/controls'
import { useLabelMode } from '../../lib/glimstone/useLabelMode'
import { useT } from '../../lib/i18n'
import { Link, navigate } from '../../lib/router'
import type { TileId } from '../../lib/routes'
import { softHyphen } from '../../lib/softHyphen'
import type { Tile } from './tiles'

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
 */
export function SettingsRail({ tiles, active }: { tiles: Tile[]; active: TileId }) {
  const { t } = useT()
  useRainbow()
  const chosen = useLabelMode('tabs')
  const mode = useNarrow() ? 'glyph' : chosen
  const [focus, setFocus] = useState(() => Math.max(0, tiles.findIndex((tile) => tile.id === active)))
  const links = useRef<(HTMLAnchorElement | null)[]>([])

  useEffect(() => {
    const at = tiles.findIndex((tile) => tile.id === active)
    if (at >= 0) setFocus(at)
  }, [tiles, active])

  const onKeyDown = (e: KeyboardEvent) => {
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
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={t('settings.tiles')}
      data-new="settings-tiles"
      onKeyDown={onKeyDown}
      // No vertical padding, so the column starts and ends flush with the
      // sidebar. The 4px at the start are what the focus ring reaches into.
      className={`flex h-full shrink-0 flex-col gap-1 overflow-y-auto ps-1 pe-2 ${mode === 'glyph' ? 'w-13' : 'w-51'}`}
    >
      {tiles.map((tile, i) => {
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
            className={`glim-nav-row glim-hue glim-hue-icon group flex shrink-0 grow basis-0 items-center rounded-[var(--radius-pill)] text-[15px] leading-5 font-medium transition-colors ${
              reactive ? 'min-h-12 flex-col justify-center gap-0.5 px-1' : 'min-h-10 px-3'
            } ${mode === 'glyph' ? 'justify-center' : reactive ? '' : 'gap-3'} ${
              selected ? 'glim-active bg-accent text-accentContrast' : 'bg-carbon-surface2 text-carbon-textSub hover:bg-carbon-surface3 hover:text-carbon-text'
            }`}
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
  )
}
