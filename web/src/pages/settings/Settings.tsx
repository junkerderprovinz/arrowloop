import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'

import type { WindowSettings } from '../../lib/api'
import type { TileId } from '../../lib/routes'
import { Apps } from '../Apps'
import { Security } from '../Security'
import { GeneralPage } from './GeneralPage'
import { InfoPage } from './InfoPage'
import { LookPage, type LookProps } from './LookPage'
import { SafetyPage } from './SafetyPage'
import { SettingsRail } from './SettingsRail'
import { jumpTarget, markHit, SettingsSearch, takeJump } from './SettingsSearch'
import { SyncPage } from './SyncPage'
import { orderTiles, rememberTile, useTileOrder, type Tile } from './tiles'
import { TargetsTile } from './TargetsTile'

export interface SettingsProps {
  tile: TileId
  tiles: Tile[]
  look: LookProps
  version: string
  window: WindowSettings | null
  onWindow: (next: WindowSettings) => void
  /** The Targets page, which its tile draws whole. */
  targets: ReactNode
  /** The button that opens what the last update changed, for the Version card. */
  whatsNew?: ReactNode
}

/** How long a search result waits for its tile's cards, which may still be reading the settings. */
const JUMP_PATIENCE_MS = 2000

/**
 * Settings as a column of tiles beside the content, with every card of the
 * open tile one under the other. Only the content column scrolls, so the tiles
 * stay where they are, and the search waits above the cards until somebody
 * scrolls up for it.
 *
 * The content column reaches down through the gutter and pads its end by the
 * same amount, as the other pages do in App.tsx, so a tile's page actions rest
 * on the window's bottom edge exactly where theirs do.
 */
export function Settings(props: SettingsProps) {
  const { tile } = props
  const saved = useTileOrder()
  const tiles = useMemo(() => orderTiles(props.tiles, saved), [props.tiles, saved])
  const content = useRef<HTMLDivElement>(null)

  // The side a new tile's cards slide in from: 1 for one further down the
  // column, -1 for one above, 0 on arrival.
  const previous = useRef<TileId | null>(null)
  const order = tiles.map((x) => x.id)
  const toward =
    previous.current === null || previous.current === tile
      ? 0
      : order.indexOf(tile) > order.indexOf(previous.current)
        ? 1
        : -1
  useEffect(() => {
    previous.current = tile
    rememberTile(tile)
    if (content.current) content.current.scrollTop = 0
  }, [tile])

  useEffect(() => {
    const jump = takeJump()
    if (!jump) return
    const started = performance.now()
    let frame = 0
    const look = () => {
      const el = content.current && jumpTarget(content.current, jump)
      const late = performance.now() - started >= JUMP_PATIENCE_MS
      // A tile that is still reading its settings shows a card of the same
      // name without the row, so the card alone is taken only at the end.
      const found = el && (!jump.row || el.dataset.glimLabel === jump.row || late)
      if (found) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        markHit(el)
      } else if (!late) {
        frame = requestAnimationFrame(look)
      }
    }
    frame = requestAnimationFrame(look)
    return () => cancelAnimationFrame(frame)
  }, [tile])

  return (
    <div className="flex min-h-0 flex-1">
      <SettingsRail tiles={tiles} active={tile} />
      <div
        ref={content}
        data-settings-content
        className="flex min-w-0 flex-1 flex-col overflow-y-auto ps-2 sm:-mb-[var(--page-gutter)] sm:px-6 md:px-8"
      >
        <SettingsSearch tiles={tiles} tile={tile} />
        <div
          key={tile}
          className={`glim-page-enter flex w-full grow flex-col gap-10 pb-4 sm:pb-[var(--page-gutter)]${toward ? ' glim-tab-slide' : ''}`}
          style={{ '--tab-dir': toward } as CSSProperties}
        >
          <TilePage {...props} />
        </div>
      </div>
    </div>
  )
}

function TilePage({ tile, look, version, window, onWindow, targets, whatsNew }: SettingsProps) {
  switch (tile) {
    case 'general':
      return <GeneralPage window={window} onWindow={onWindow} />
    case 'look':
      return <LookPage {...look} />
    case 'sync':
      return <SyncPage />
    case 'safety':
      return <SafetyPage />
    case 'targets':
      return <TargetsTile page={targets} />
    case 'security':
      return <Security />
    case 'apps':
      return <Apps version={version} desktop={window !== null} />
    case 'info':
      return <InfoPage version={version} whatsNew={whatsNew} />
  }
}
