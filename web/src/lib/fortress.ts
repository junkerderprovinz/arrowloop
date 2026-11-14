// What the fortress shows of the engine's view, in GlimStone's shapes: the
// other apps with a row per place they run, and the permissions that involve
// ArrowLoop in its own words. The phone reads the same rules, so nothing here
// may import the browser's api.ts or GlimStone's packages.

import type { Translate, TranslationKey } from './i18n.data'

export const SELF = { id: 'arrowloop', name: 'ArrowLoop' }

/** One instance of another app in the fortress (internal/web/fortress_member.go). */
export type FortressMember = {
  id: string
  /** The app's id, such as "bombvault", and its name, both empty for a member that never said which app it runs. */
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
  /** The server it says it runs on. */
  host?: string
  /** Whether its pages open from here through the fortress. */
  pages: boolean
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
  /** The members taken out here since the phrase last changed, which keeps the fortress closed to new apps until then. */
  removed: FortressRemoved[]
  /** Another member took this instance out, and it has not joined again since. */
  removedHere: boolean
  /** A member said the fortress has a new phrase, which nobody in reach hands over, so the owner enters it. */
  phraseChanged: boolean
}

/** A member a phrase change did not reach. `app` is empty for one that never said which app it runs. */
export type FortressLeft = { app: string; device: string }

/** The members a phrase change did not reach, each as its app on its device in `on`'s words. */
export function leftNames(left: FortressLeft[], on: (app: string, device: string) => string): string[] {
  return left.map((l) => (l.app ? on(l.app, l.device) : l.device))
}

/** A member taken out of the fortress, by the names it went by. */
export type FortressRemoved = { app: string; name: string; device: string }

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
  /** Set on every instance of a known app, so that its card offers Open. */
  open?: { href?: string; host?: string }
  /** Another member claims the same app on the same server or device. */
  doubt?: boolean
  /** The end of its id, as the bar above an opened page shows it. */
  print?: string
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
  if (m.deployment === 'phone' || m.deployment === 'android' || m.kind === 'mobile') return 'phone'
  if (m.deployment === 'desktop') return 'pc'
  return 'server'
}

/**
 * Whether another member claims m's app on m's server or device. One of the
 * two could be pretending, so Open asks first.
 */
function doubted(m: FortressMember, members: FortressMember[]): boolean {
  return members.some((o) => o.id !== m.id && !!m.app && o.app === m.app && ((!!m.host && o.host === m.host) || o.device === m.device))
}

/** The card a member goes on: its app's, or one of its own under its device's name for a member that never said its app. */
const cardOf = (m: FortressMember) => m.app || m.id

/**
 * The other apps of the fortress, each with its instances, sorted by name. A
 * member that never said its app has nothing to open.
 */
export function fortressApps(members: FortressMember[], ago: (unix: number) => string): FortressAppView[] {
  const apps = new Map<string, FortressAppView>()
  for (const m of members) {
    if (m.app === SELF.id) continue
    const key = cardOf(m)
    const app = apps.get(key) ?? { id: key, name: m.app ? m.name || m.app : m.device || m.id.slice(-8), instances: [] }
    app.instances.push({
      id: m.id,
      device: m.device,
      deviceKind: deviceKind(m),
      form: m.deployment === 'phone' ? 'android' : m.deployment || undefined,
      version: m.version || undefined,
      presence: m.online ? 'connected' : 'away',
      relay: m.relay,
      lastSeen: !m.online && m.lastSeen ? ago(m.lastSeen) : undefined,
      open: m.app ? {} : undefined,
      doubt: doubted(m, members),
      print: m.id.slice(-8),
    })
    apps.set(key, app)
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
  return new Set(f.members.filter((m) => m.app !== SELF.id).map(cardOf)).size + 3
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

/** A member's status report as the engine hands it on, in the member's words. */
export type MemberStatus = {
  report: {
    state: string
    needsYou: { severity: string; text: string }[]
    work: { title: string; progress?: number }[]
    next: { title: string; at: string }[]
  }
  /** The end of its log, newest first. */
  log: { at: string; level: string; text: string }[]
}

/** The report and the log as GlimStone's status window shows them, each time in the reader's words. */
export function statusLines(status: MemberStatus, when: (at: string) => string): MemberStatus {
  const r = status.report
  return {
    report: {
      state: r.state,
      needsYou: (r.needsYou ?? []).map((n) => ({ severity: n.severity, text: n.text })),
      work: (r.work ?? []).map((w) => (w.progress === undefined ? { title: w.title } : { title: w.title, progress: w.progress })),
      next: (r.next ?? []).map((n) => ({ title: n.title, at: when(n.at) })),
    },
    log: (status.log ?? []).map((l) => ({ at: when(l.at), level: l.level, text: l.text })),
  }
}
