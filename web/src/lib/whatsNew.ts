// What an update changed, by release (GlimStone, "First start and what's
// new"). After an update a glowing dot marks each change where it is drawn and
// on every link that leads there. The way is read from the change's address,
// so a change names where it is and nothing about how to get there.
//
// A release adds one entry at the top of RELEASES and its sentences under
// new.change.* in the translation tables.

import type { Translate, TranslationKey } from './i18n.data'

export interface Change {
  /** The value of data-new on the changed element, and what "seen" remembers. */
  id: string
  /**
   * The addresses the element is drawn at, as routes where `:name` stands for
   * any one segment. The first one with a link on its way is followed, so a
   * page that may be pinned names its sidebar address before its tile.
   */
  at: string[]
  /** Where "Go there" leads, for an address that names one entry. */
  go?: string
  /** The page's name in the list, outermost first. */
  where: TranslationKey[]
  text: TranslationKey
  /** Labels the sentence quotes, read from the labels themselves so the two cannot disagree. */
  names?: Record<string, TranslationKey>
}

export interface Release {
  /**
   * The last release without these changes. The number of the one that brings
   * them is decided when it is tagged; this one is known while they are
   * written.
   */
  after: string
  changes: Change[]
}

const JOBS: TranslationKey[] = ['nav.jobs']

/** Newest first. Only the newest release an update passes is marked. */
export const RELEASES: Release[] = [
  {
    after: '1.8.0',
    changes: [
      {
        id: 'navigation',
        at: ['/jobs'],
        where: ['new.where.navigation'],
        text: 'new.change.navigation',
        names: {
          conflicts: 'nav.conflicts',
          anomalies: 'nav.anomalies',
          trash: 'nav.trash',
          targets: 'nav.targets',
          settings: 'nav.settings',
        },
      },
      { id: 'run-strip', at: ['/jobs'], where: JOBS, text: 'new.change.runStrip' },
      {
        id: 'job-page',
        at: ['/jobs/:name'],
        go: '/jobs',
        where: ['nav.jobs', 'new.where.jobPage'],
        text: 'new.change.jobPage',
      },
      {
        id: 'list-bar',
        at: ['/history'],
        where: ['nav.history'],
        text: 'new.change.listBar',
        names: {
          history: 'nav.history',
          filter: 'list.filter',
          search: 'list.search',
          files: 'history.files',
          runs: 'history.runs',
        },
      },
      {
        id: 'finding-cards',
        at: ['/anomalies'],
        where: ['nav.anomalies'],
        text: 'new.change.findingCards',
        names: { anomalies: 'nav.anomalies', more: 'anomaly.showMore' },
      },
      {
        id: 'learning',
        at: ['/anomalies'],
        where: ['nav.anomalies'],
        text: 'new.change.learning',
        names: { learning: 'anomaly.learn.title' },
      },
      {
        id: 'conflict-cards',
        at: ['/conflicts'],
        where: ['nav.conflicts'],
        text: 'new.change.conflictCards',
        names: { conflicts: 'nav.conflicts' },
      },
      {
        id: 'trash-actions',
        at: ['/trash'],
        where: ['nav.trash'],
        text: 'new.change.trashActions',
        names: { prune: 'trash.prune', empty: 'trash.emptyAll' },
      },
      {
        id: 'job-brakes',
        at: ['/jobs/:name'],
        go: '/jobs',
        where: ['nav.jobs', 'new.where.jobPage'],
        text: 'new.change.jobBrakes',
        names: { brakes: 'job.brakes' },
      },
      { id: 'job-more', at: ['/jobs'], where: JOBS, text: 'new.change.jobMore', names: { more: 'list.more' } },
      {
        id: 'own-values',
        at: ['/jobs/:name'],
        go: '/jobs',
        where: ['nav.jobs', 'new.where.jobPage'],
        text: 'new.change.ownValues',
        names: { sync: 'settings.sync', override: 'defaults.override', useDefault: 'defaults.useDefault' },
      },
      {
        id: 'schedule-sentence',
        at: ['/settings/sync'],
        where: ['nav.settings', 'settings.sync'],
        text: 'new.change.scheduleSentence',
        names: { cron: 'schedule.cron' },
      },
      {
        id: 'exceptions',
        at: ['/settings/sync'],
        where: ['nav.settings', 'settings.sync'],
        text: 'new.change.exceptions',
        names: { exceptions: 'defaults.exceptions', sync: 'settings.sync' },
      },
      {
        id: 'provider-names',
        at: ['/targets', '/settings/targets'],
        where: ['nav.targets'],
        text: 'new.change.providerNames',
        names: { connect: 'targets.addStorage' },
      },
      {
        id: 'settings-tiles',
        at: ['/settings/:tile'],
        go: '/settings',
        where: ['nav.settings'],
        text: 'new.change.settingsTiles',
        names: {
          settings: 'nav.settings',
          engine: 'settings.engine',
          general: 'settings.general',
          sync: 'settings.sync',
          safety: 'settings.safetyNet',
        },
      },
      {
        id: 'settings-search',
        at: ['/settings/:tile'],
        go: '/settings',
        where: ['nav.settings'],
        text: 'new.change.settingsSearch',
      },
      {
        id: 'anomalies-module',
        at: ['/settings/safety'],
        where: ['nav.settings', 'settings.safetyNet'],
        text: 'new.change.anomaliesModule',
        names: { anomalies: 'nav.anomalies', safety: 'settings.safetyNet' },
      },
      {
        id: 'info-tile',
        at: ['/settings/info'],
        where: ['nav.settings', 'settings.info'],
        text: 'new.change.infoTile',
        names: { info: 'settings.info', help: 'info.help' },
      },
      {
        id: 'login-reset',
        at: ['/settings/security'],
        where: ['nav.settings', 'settings.security'],
        text: 'new.change.loginReset',
      },
      {
        id: 'notify-channels',
        at: ['/settings/safety'],
        where: ['nav.settings', 'settings.safetyNet'],
        text: 'new.change.notifyChannels',
        names: { notifications: 'settings.notifications', safety: 'settings.safetyNet' },
      },
    ],
  },
]

type Version = [number, number, number]

function parse(version: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.split('+')[0].trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * The newest release whose changes an update from `from` to `running` passes.
 * A stamp that is no release number, such as "dev" or a build between two
 * tags, is what comes next when it runs and older than every release when it
 * was left.
 */
export function releaseSince(from: string, running: string, releases: Release[] = RELEASES): Release | undefined {
  const was = parse(from)
  const now = parse(running)
  return releases.find((r) => {
    const after = parse(r.after)
    if (!after) return false
    return (!was || compare(after, was) >= 0) && (!now || compare(after, now) < 0)
  })
}

/** Whether a path is drawn at a route, segment by segment. */
export function matchRoute(route: string, path: string): boolean {
  const want = route.split('/').filter(Boolean)
  const have = path.split('/').filter(Boolean)
  return want.length === have.length && want.every((part, i) => part.startsWith(':') || part === have[i])
}

/** Whether `here` is one of the addresses a change is drawn at. */
export function isAt(change: Change, here: string): boolean {
  return change.at.some((route) => matchRoute(route, here))
}

/**
 * The addresses whose links lead from `here` towards `route`: the page and
 * every section above it. A link to where the reader is, or to a section they
 * are inside, leads nowhere new and is left out.
 */
export function trail(route: string, here: string): string[] {
  const parts = route.split('/').filter(Boolean)
  const steps = parts.map((_, i) => `/${parts.slice(0, i + 1).join('/')}`)
  const inside = (step: string) => {
    const depth = step.split('/').filter(Boolean).length
    return matchRoute(step, `/${here.split('/').filter(Boolean).slice(0, depth).join('/')}`)
  }
  return steps.filter((step) => !inside(step))
}

/** What a change says, with the labels it quotes in the reader's language. */
export function sentenceOf(t: Translate, change: Change): string {
  const names = Object.entries(change.names ?? {}).map(([name, key]) => [name, t(key)])
  return t(change.text, Object.fromEntries(names))
}

/** Where "Go there" leads for a change. */
export function goOf(change: Change): string {
  return change.go ?? change.at[0]
}
