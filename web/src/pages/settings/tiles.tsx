import type { ComponentType } from 'react'

import {
  IconAnomalies,
  IconDashboard,
  IconFilter,
  IconInfo,
  IconNotifications,
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
  /**
   * A list rather than a form, which uses the column's whole width. Every
   * other tile is rows with a name at one end and a control at the other,
   * capped at 880px so the two stay together in a wide window.
   */
  wide?: boolean
}

const TILES: Record<TileId, Tile> = {
  general: { id: 'general', labelKey: 'settings.general', icon: IconTabGeneral },
  look: { id: 'look', labelKey: 'settings.look', icon: IconTabLook },
  sync: { id: 'sync', labelKey: 'settings.sync', icon: IconSync },
  workload: { id: 'workload', labelKey: 'settings.workload', icon: IconDashboard },
  safety: { id: 'safety', labelKey: 'settings.safetyNet', icon: IconShieldOn },
  notifications: { id: 'notifications', labelKey: 'settings.notifications', icon: IconNotifications },
  exclude: { id: 'exclude', labelKey: 'settings.excludeLists', icon: IconFilter },
  targets: { id: 'targets', labelKey: 'nav.targets', icon: IconTabStorage, wide: true },
  anomalies: { id: 'anomalies', labelKey: 'nav.anomalies', icon: IconAnomalies, wide: true },
  security: { id: 'security', labelKey: 'settings.security', icon: IconTabSecurity },
  app: { id: 'app', labelKey: 'settings.app', icon: IconTabApp },
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
}

/**
 * Old names stay findable in the search, listed first, since somebody who
 * learned the old app looks for the old word.
 */
export const FORMER_NAMES: FormerName[] = [
  { labelKey: 'settings.engine', tile: 'sync' },
  { labelKey: 'engine.work', tile: 'workload' },
  { labelKey: 'engine.memory', tile: 'workload' },
  { labelKey: 'engine.telling', tile: 'notifications' },
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
