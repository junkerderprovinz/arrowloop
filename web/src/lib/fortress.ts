// What the fortress shows of the engine's view, in GlimStone's shapes: the
// other apps with a row per place they run, and the permissions that involve
// ArrowLoop in its own words. The phone reads the same rules, so nothing here
// may import the browser's api.ts or GlimStone's packages.

import type { Translate, TranslationKey } from './i18n.data'

export const SELF = { id: 'arrowloop', name: 'ArrowLoop' }

/** One instance of another app in the fortress (internal/web/fortress_member.go). */
export type FortressMember = {
  id: string
  /** The app's id, such as "bombvault", and its name. */
  app: string
  name: string
  version: string
  device: string
  deployment: string
  kind: string
  online: boolean
  /** Reached through the relay alone. */
  relay: boolean
  lastSeen?: number
}

/** What one app may do at another, as one switch. */
export type FortressPermission = { from: string; to: string; action: string; on: boolean }

/** Where this instance stands in the fortress. It never carries the phrase. */
export type FortressInfo = {
  joined: boolean
  /** Whether this instance keeps the phrase to show and change it. */
  phrase: boolean
  device: string
  defaultDevice: string
  passwordSet: boolean
  members: FortressMember[]
  /** The permissions that involve ArrowLoop. */
  permissions: FortressPermission[]
}

/** GlimStone's FortressInstance. */
export type FortressInstanceView = {
  id: string
  device: string
  deviceKind: 'server' | 'pc' | 'laptop' | 'phone'
  form?: string
  version?: string
  presence: 'connected' | 'away'
  relay: boolean
  lastSeen?: string
}

/** GlimStone's FortressApp. */
export type FortressAppView = { id: string; name: string; instances: FortressInstanceView[] }

/** GlimStone's FortressPermission. */
export type FortressPermissionView = { id: string; from: string; to: string[]; on: boolean; title: string; detail: string }

/** The actions ArrowLoop has words for, all of them its own. */
const ACTION_TITLES: Record<string, TranslationKey> = {
  'jobs.list': 'fortress.action.jobsList',
  'jobs.run': 'fortress.action.jobsRun',
  'jobs.targets': 'fortress.action.jobsTargets',
  'jobs.create': 'fortress.action.jobsCreate',
  'backup.export': 'fortress.action.backupExport',
  'backup.import': 'fortress.action.backupImport',
  'ui.open': 'fortress.action.uiOpen',
}

function deviceKind(m: FortressMember): FortressInstanceView['deviceKind'] {
  if (m.deployment === 'phone' || m.kind === 'mobile') return 'phone'
  if (m.deployment === 'desktop') return 'pc'
  return 'server'
}

/** The other apps of the fortress, each with its instances, sorted by name. */
export function fortressApps(members: FortressMember[], ago: (unix: number) => string): FortressAppView[] {
  const apps = new Map<string, FortressAppView>()
  for (const m of members) {
    if (m.app === SELF.id) continue
    const app = apps.get(m.app) ?? { id: m.app, name: m.name || m.app, instances: [] }
    app.instances.push({
      id: m.id,
      device: m.device,
      deviceKind: deviceKind(m),
      form: m.deployment === 'phone' ? 'android' : m.deployment || undefined,
      version: m.version || undefined,
      presence: m.online ? 'connected' : 'away',
      relay: m.relay,
      lastSeen: !m.online && m.lastSeen ? ago(m.lastSeen) : undefined,
    })
    apps.set(m.app, app)
  }
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function fortressPermissions(permissions: FortressPermission[], members: FortressMember[], t: Translate): FortressPermissionView[] {
  const name = (id: string) => (id === SELF.id ? SELF.name : (members.find((m) => m.app === id)?.name ?? id))
  return permissions.map((p) => {
    const words = ACTION_TITLES[p.action]
    return {
      id: `${p.from} ${p.to} ${p.action}`,
      from: p.from,
      to: [p.to],
      on: p.on,
      title: words ? t(words) : p.action,
      detail: t('fortress.permissionPair', { from: name(p.from), to: name(p.to) }),
    }
  })
}

/**
 * How many rainbow positions the fortress takes: its first card, and once
 * joined a card per other app, the permissions and the card that leaves.
 */
export function fortressHues(f: FortressInfo): number {
  if (!f.joined) return 1
  return new Set(f.members.filter((m) => m.app !== SELF.id).map((m) => m.app)).size + 3
}

/** The permission an id of fortressPermissions names. */
export function permissionOf(id: string, on: boolean): FortressPermission {
  const [from = '', to = '', action = ''] = id.split(' ')
  return { from, to, action, on }
}

/**
 * The instances paired with this one, whose pairing moves into the fortress
 * on joining and ends on leaving.
 */
export function pairedWith(group: {
  members: { id: string; name: string; approved: boolean }[]
  away: { id: string; name: string }[]
}): string[] {
  return [...new Set([...group.members.filter((m) => m.approved), ...group.away].map((m) => m.name || m.id))]
}
