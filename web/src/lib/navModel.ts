// The one ordered list of the app's places. The sidebar, the bar a narrow
// window shows instead and that bar's More sheet are filters of it, so no two
// of them can name, order or draw a place differently.
//
// The list holds no colour: a rainbow position is an entry's rank among the
// entries a surface shows, so each surface counts as it renders.

import type { ComponentType } from 'react'

import {
  IconAnomalies,
  IconConflict,
  IconGear,
  IconHistory,
  IconSync,
  IconTabStorage,
  IconTrash,
} from '../components/glyphs'
import type { TranslationKey } from './i18n.data'

/** What an entry counts beside its name. */
export type NavCountKind = 'running' | 'conflicts' | 'trash' | 'findings'

export type NavCounts = Record<NavCountKind, number>

export interface NavDestination {
  to: string
  labelKey: TranslationKey
  icon: ComponentType
  count?: NavCountKind
  sidebar: boolean
  /** Stands at the foot of the sidebar, below sign out. */
  footer: boolean
  /** A slot of the bottom bar; every other entry waits in the More sheet. */
  bar: boolean
}

/** The places that are not always in the rail: Targets while pinned, Anomalies while switched on. */
export type NavExtras = { targets: boolean; anomalies: boolean }

/**
 * The whole navigation in sidebar order. A pin flips a flag and never removes
 * an entry, so the order between any two entries is the same everywhere.
 * Anomalies stands beside Conflicts, since both list what waits for an answer.
 */
export function destinations(extras: NavExtras): NavDestination[] {
  return [
    { to: '/jobs', labelKey: 'nav.jobs', icon: IconSync, count: 'running', sidebar: true, footer: false, bar: true },
    { to: '/conflicts', labelKey: 'nav.conflicts', icon: IconConflict, count: 'conflicts', sidebar: true, footer: false, bar: true },
    ...(extras.anomalies
      ? [{ to: '/anomalies', labelKey: 'nav.anomalies', icon: IconAnomalies, count: 'findings', sidebar: true, footer: false, bar: false } as const]
      : []),
    { to: '/trash', labelKey: 'nav.trash', icon: IconTrash, count: 'trash', sidebar: true, footer: false, bar: false },
    { to: '/history', labelKey: 'nav.history', icon: IconHistory, sidebar: true, footer: false, bar: true },
    { to: '/targets', labelKey: 'nav.targets', icon: IconTabStorage, sidebar: extras.targets, footer: false, bar: false },
    { to: '/settings', labelKey: 'nav.settings', icon: IconGear, sidebar: true, footer: true, bar: true },
  ]
}

export function sidebarDestinations(extras: NavExtras): NavDestination[] {
  return destinations(extras).filter((d) => d.sidebar)
}

export function barDestinations(extras: NavExtras): NavDestination[] {
  return destinations(extras).filter((d) => d.bar)
}

/** The More sheet lists every page without a slot, pinned or not, so it is never empty. */
export function moreDestinations(extras: NavExtras): NavDestination[] {
  return destinations(extras).filter((d) => !d.bar)
}

/** Whether a path is the destination or a page below it. */
export function onDestination(pathname: string, d: NavDestination): boolean {
  return pathname === d.to || pathname.startsWith(`${d.to}/`)
}
