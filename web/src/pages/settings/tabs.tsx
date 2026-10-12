import type { ComponentType } from 'react'

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
import { TAB_IDS, type TabId } from '../../lib/routes'

export interface SettingsTab {
  id: TabId
  labelKey: TranslationKey
  icon: ComponentType
  /**
   * A list rather than a form, which uses the page's whole width. Every other
   * tab is rows with a name at one end and a control at the other, capped at
   * 880px so the two stay together in a wide window.
   */
  wide?: boolean
}

const TABS: Record<TabId, SettingsTab> = {
  general: { id: 'general', labelKey: 'settings.general', icon: IconTabGeneral },
  look: { id: 'look', labelKey: 'settings.look', icon: IconTabLook },
  sync: { id: 'sync', labelKey: 'settings.sync', icon: IconSync },
  safety: { id: 'safety', labelKey: 'settings.safetyNet', icon: IconShieldOn },
  targets: { id: 'targets', labelKey: 'nav.targets', icon: IconTabStorage, wide: true },
  security: { id: 'security', labelKey: 'settings.security', icon: IconTabSecurity },
  apps: { id: 'apps', labelKey: 'settings.apps', icon: IconTabApp },
  info: { id: 'info', labelKey: 'settings.info', icon: IconInfo },
}

/**
 * The tabs this build offers. Security is left out where the interface cannot
 * keep a password of its own, the desktop window; `security` is null while
 * nobody has asked yet, which keeps the tab so its address does not bounce.
 */
export function settingsTabs(security: boolean | null): SettingsTab[] {
  return TAB_IDS.filter((id) => id !== 'security' || security !== false).map((id) => TABS[id])
}

/** A name the settings carried in an earlier version, and the tab that holds it. */
export interface FormerName {
  labelKey: TranslationKey
  tab: TabId
}

/**
 * Old names stay findable in the search, listed first, since somebody who
 * learned the old app looks for the old word.
 */
export const FORMER_NAMES: FormerName[] = [
  { labelKey: 'settings.engine', tab: 'sync' },
  { labelKey: 'settings.app', tab: 'apps' },
  { labelKey: 'engine.work', tab: 'general' },
  { labelKey: 'engine.memory', tab: 'general' },
  { labelKey: 'engine.telling', tab: 'safety' },
]

const REMEMBERED = 'arrowloop.settingsTile'

export function rememberedTab(): string | null {
  try {
    return localStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}

export function rememberTab(id: TabId) {
  try {
    localStorage.setItem(REMEMBERED, id)
  } catch {
    // Without storage Settings opens on its first tab, which is no loss.
  }
}
