import { useMemo, useSyncExternalStore, type ComponentType } from 'react'

import {
  IconInfo,
  IconShieldOn,
  IconSync,
  IconTabApp,
  IconTabGeneral,
  IconTabLook,
  IconTabSecurity,
  IconTabStorage,
} from '../../components/glyphs'
import type { TranslationKey } from '../../lib/i18n'
import { TILE_IDS, type TileId } from '../../lib/routes'

export interface Tile {
  id: TileId
  labelKey: TranslationKey
  icon: ComponentType
}

const TILES: Record<TileId, Tile> = {
  general: { id: 'general', labelKey: 'settings.general', icon: IconTabGeneral },
  look: { id: 'look', labelKey: 'settings.look', icon: IconTabLook },
  sync: { id: 'sync', labelKey: 'settings.sync', icon: IconSync },
  safety: { id: 'safety', labelKey: 'settings.safetyNet', icon: IconShieldOn },
  targets: { id: 'targets', labelKey: 'nav.targets', icon: IconTabStorage },
  security: { id: 'security', labelKey: 'settings.security', icon: IconTabSecurity },
  apps: { id: 'apps', labelKey: 'settings.apps', icon: IconTabApp },
  info: { id: 'info', labelKey: 'settings.info', icon: IconInfo },
}

/**
 * The tiles this build offers. Security is left out where the interface cannot
 * keep a password of its own, the desktop window; `security` is null while
 * nobody has asked yet, which keeps the tile so its address does not bounce.
 */
export function settingsTiles(security: boolean | null): Tile[] {
  return TILE_IDS.filter((id) => id !== 'security' || security !== false).map((id) => TILES[id])
}

/** A name the settings carried in an earlier version, and the tile that holds it. */
export interface FormerName {
  labelKey: TranslationKey
  tile: TileId
  /** The card that carries the thing under its new name, where it was a card. */
  card?: TranslationKey
}

/**
 * Old names stay findable in the search, listed first, since somebody who
 * learned the old app looks for the old word.
 */
export const FORMER_NAMES: FormerName[] = [
  { labelKey: 'settings.engine', tile: 'sync' },
  { labelKey: 'settings.app', tile: 'apps' },
  { labelKey: 'engine.work', tile: 'general' },
  { labelKey: 'engine.memory', tile: 'general' },
  { labelKey: 'engine.telling', tile: 'safety' },
  { labelKey: 'former.backup', tile: 'general', card: 'backup.title' },
  { labelKey: 'former.contents', tile: 'sync', card: 'settings.contents' },
]

const REMEMBERED = 'arrowloop.settingsTile'

export function rememberedTile(): string | null {
  try {
    return localStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}

export function rememberTile(id: TileId) {
  try {
    localStorage.setItem(REMEMBERED, id)
  } catch {
    // Without storage Settings opens on its first tile, which is no loss.
  }
}

const ORDER = 'arrowloop.settingsOrder'

function readOrder(): string {
  try {
    return localStorage.getItem(ORDER) ?? ''
  } catch {
    return ''
  }
}

function parseOrder(raw: string): string[] {
  try {
    const stored: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  } catch {
    // A hand-edited value falls back to the app's own order.
    return []
  }
}

const orderListeners = new Set<() => void>()

function subscribeOrder(listener: () => void) {
  orderListeners.add(listener)
  // Another tab moving a tile moves it here too.
  window.addEventListener('storage', listener)
  return () => {
    orderListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/** The order the person dragged the tiles into, kept per browser; empty for the app's own. */
export function useTileOrder(): string[] {
  const raw = useSyncExternalStore(subscribeOrder, readOrder)
  return useMemo(() => parseOrder(raw), [raw])
}

/** Keeps an order, or with null goes back to the app's own. */
export function setTileOrder(ids: string[] | null) {
  try {
    if (ids) localStorage.setItem(ORDER, JSON.stringify(ids))
    else localStorage.removeItem(ORDER)
  } catch {
    // Without storage the order lasts until the page reloads.
    return
  }
  for (const listener of orderListeners) listener()
}

/**
 * The tiles in the person's order. A tile the stored order does not know yet
 * goes in after the tile that comes before it in the app's own list, so a new
 * tile turns up near its topic rather than at the end.
 */
export function orderTiles(tiles: Tile[], saved: readonly string[]): Tile[] {
  const ids = saved.filter((id) => tiles.some((tile) => tile.id === id))
  tiles.forEach((tile, i) => {
    if (ids.includes(tile.id)) return
    const before = i > 0 ? ids.indexOf(tiles[i - 1].id) : -1
    ids.splice(before + 1, 0, tile.id)
  })
  return ids.map((id) => tiles.find((tile) => tile.id === id)!)
}

/** Whether an order is the app's own, so Reset has nothing to do. */
export function isOwnOrder(saved: readonly string[]): boolean {
  const known = saved.filter((id) => (TILE_IDS as readonly string[]).includes(id))
  return known.every((id, i) => i === 0 || TILE_IDS.indexOf(known[i - 1] as TileId) < TILE_IDS.indexOf(id as TileId))
}
