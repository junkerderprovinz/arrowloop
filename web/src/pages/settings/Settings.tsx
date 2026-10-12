import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

import type { WindowSettings } from '../../lib/api'
import type { TileId } from '../../lib/routes'
import { Apps } from '../Apps'
import { Security } from '../Security'
import { ExcludePage } from './ExcludePage'
import { GeneralPage } from './GeneralPage'
import { InfoPage } from './InfoPage'
import { LookPage, type LookProps } from './LookPage'
import { AnomaliesTile, TargetsTile } from './ModuleTiles'
import { NotificationsPage } from './NotificationsPage'
import { SafetyPage } from './SafetyPage'
import { SettingsRail } from './SettingsRail'
import { jumpTarget, markHit, SettingsSearch, takeJump } from './SettingsSearch'
import { SyncPage } from './SyncPage'
import { rememberTile, type Tile } from './tiles'
import { WorkloadPage } from './WorkloadPage'

export interface SettingsProps {
  tile: TileId
  tiles: Tile[]
  look: LookProps
  version: string
  window: WindowSettings | null
  onWindow: (next: WindowSettings) => void
  /** The two pages a tile draws whole while they are not in the sidebar. */
  targets: ReactNode
  anomalies: ReactNode
  /** The list of what the last update changed, for the Info tile. */
  whatsNew?: ReactNode
}

/** How long a search result waits for its tile's cards, which may still be reading the settings. */
const JUMP_PATIENCE_MS = 2000

/**
 * Settings as a column of tiles beside the content. Only the content column
 * scrolls, so the tiles stay where they are.
 */
export function Settings(props: SettingsProps) {
  const { tile, tiles } = props
  const wide = tiles.find((x) => x.id === tile)?.wide ?? false
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
        className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto ps-2 pb-[var(--page-gutter)] sm:px-6 md:px-8"
      >
        {/* The cap belongs to the page: a form of rows with a name at one end
            and a control at the other is held to 880px so the two stay
            together in a wide window, and the search ends where its cards do. */}
        <div className={`flex w-full flex-col gap-6 ${wide ? '' : 'max-w-[880px]'}`}>
          <SettingsSearch tiles={tiles} tile={tile} />
          <div
            key={tile}
            className={`glim-page-enter flex flex-col gap-10${toward ? ' glim-tab-slide' : ''}`}
            style={{ '--tab-dir': toward } as CSSProperties}
          >
            <TilePage {...props} />
          </div>
        </div>
      </div>
    </div>
  )
}

function TilePage({ tile, look, version, window, onWindow, targets, anomalies, whatsNew }: SettingsProps) {
  switch (tile) {
    case 'general':
      return <GeneralPage window={window} onWindow={onWindow} />
    case 'look':
      return <LookPage {...look} />
    case 'sync':
      return <SyncPage />
    case 'workload':
      return <WorkloadPage />
    case 'safety':
      return <SafetyPage />
    case 'notifications':
      return <NotificationsPage />
    case 'exclude':
      return <ExcludePage />
    case 'targets':
      return <TargetsTile page={targets} />
    case 'anomalies':
      return <AnomaliesTile page={anomalies} />
    case 'security':
      return <Security />
    case 'app':
      return <Apps version={version} desktop={window !== null} />
    case 'info':
      return <InfoPage version={version} whatsNew={whatsNew} />
  }
}
