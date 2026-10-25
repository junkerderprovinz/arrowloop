// What each release brought (GlimStone, "First start and what's new"). After
// an update a glowing dot marks each change of every release since the one the
// browser had before, where it is drawn and on every link that leads there.
// The way is read from the change's address, so a change names where it is and
// nothing about how to get there.
//
// A release adds one entry at the top of RELEASES and its sentences under
// new.change.* in the translation tables.

import type { Translate, TranslationKey } from './i18n.data'

/** A change drawn on a page, marked on its element and on the way there. */
interface Placed {
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
  /**
   * The data-new-way of the control that opens the window the change is drawn
   * in, so the dot waits on that control while the window is closed.
   */
  via?: string
  /** The page's name in the list, outermost first. */
  where: TranslationKey[]
  text: TranslationKey
  /** Labels the sentence quotes, read from the labels themselves so the two cannot disagree. */
  names?: Record<string, TranslationKey>
}

/** A change no page of the web interface draws, such as one in the phone app. Its dot stands in the list only. */
interface Unplaced {
  id: string
  at?: undefined
  text: TranslationKey
  names?: Record<string, TranslationKey>
}

export interface Release {
  /**
   * The last release without these changes. The number of the one that brings
   * them is decided when it is tagged; this one is known while they are
   * written.
   */
  after: string
  changes: (Placed | Unplaced)[]
}

export type Change = (Placed | Unplaced) & { after: string }
export type PlacedChange = Placed & { after: string }

export function placed(change: Change): change is PlacedChange {
  return change.at !== undefined
}

const JOBS: TranslationKey[] = ['nav.jobs']

/** Every release that brought something new, newest first. */
export const RELEASES: Release[] = [
  {
    after: '2.2.8',
    changes: [
      {
        id: 'phone-job-editor',
        text: 'new.change.phoneJobEditor',
        names: { schedule: 'edit.schedule', sync: 'edit.cardSync', exclude: 'edit.exclude', useGlobal: 'edit.useGlobal' },
      },
      {
        id: 'job-window',
        at: ['/jobs/:name'],
        via: 'edit-job',
        go: '/jobs',
        where: ['nav.jobs', 'new.where.jobPage'],
        text: 'new.change.jobWindow',
        names: { schedule: 'edit.schedule', matching: 'edit.matching', exclude: 'edit.exclude' },
      },
      {
        id: 'use-global',
        at: ['/jobs/:name'],
        via: 'edit-job',
        go: '/jobs',
        where: ['nav.jobs', 'new.where.jobPage'],
        text: 'new.change.useGlobal',
        names: { useGlobal: 'edit.useGlobal' },
      },
      {
        id: 'target-switches',
        at: ['/targets', '/settings/targets'],
        via: 'connect',
        where: ['nav.targets'],
        text: 'new.change.targetSwitches',
        names: { encryption: 'targets.ftpTls' },
      },
      {
        id: 'target-setup-choice',
        at: ['/targets', '/settings/targets'],
        via: 'connect',
        where: ['nav.targets'],
        text: 'new.change.setupChoice',
      },
      {
        id: 'target-bucket',
        at: ['/targets', '/settings/targets'],
        via: 'connect',
        where: ['nav.targets'],
        text: 'new.change.bucketField',
      },
      {
        id: 'provider-marks',
        at: ['/targets', '/settings/targets'],
        via: 'connect',
        where: ['nav.targets'],
        text: 'new.change.providerMarks',
        names: { connect: 'targets.addStorage' },
      },
      {
        id: 'two-factor-once',
        at: ['/targets', '/settings/targets'],
        via: 'connect',
        where: ['nav.targets'],
        text: 'new.change.twoFactorOnce',
        names: { code: 'opt.twoFactor', test: 'targets.check' },
      },
      {
        id: 'target-in-use',
        at: ['/targets', '/settings/targets'],
        where: ['nav.targets'],
        text: 'new.change.targetInUse',
        names: { delete: 'action.delete' },
      },
      {
        id: 'smb-share',
        at: ['/targets', '/settings/targets'],
        via: 'connect',
        where: ['nav.targets'],
        text: 'new.change.smbShare',
        names: { share: 'opt.shareName', test: 'targets.check' },
      },
      {
        id: 'sftp-host-key',
        at: ['/targets', '/settings/targets'],
        via: 'connect',
        where: ['nav.targets'],
        text: 'new.change.hostKey',
        names: { test: 'targets.check', key: 'targets.hostKey' },
      },
    ],
  },
  {
    after: '2.2.6',
    changes: [{ id: 'installer', text: 'new.change.installer' }],
  },
  {
    after: '2.2.5',
    changes: [
      {
        id: 'newer-wins',
        at: ['/jobs/:name'],
        go: '/jobs',
        where: ['nav.jobs', 'new.where.jobPage'],
        text: 'new.change.newerWins',
        names: { option: 'edit.newerWins' },
      },
    ],
  },
  {
    after: '2.2.3',
    changes: [{ id: 'release-cards', text: 'new.change.releaseCards' }],
  },
  {
    after: '2.1.0',
    changes: [
      {
        id: 'app-folders',
        text: 'new.change.appFolders',
        names: { add: 'phone.sharedAdd', settings: 'nav.settings', phone: 'phone.thisPhone' },
      },
    ],
  },
  {
    after: '1.9.0',
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
        id: 'target-rows',
        at: ['/targets', '/settings/targets'],
        where: ['nav.targets'],
        text: 'new.change.targetRows',
        names: {
          test: 'targets.check',
          connected: 'targets.checkOk',
          notConnected: 'targets.checkFailed',
          saved: 'notify.saved',
          change: 'notify.change',
        },
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
        id: 'tile-order',
        at: ['/settings/look'],
        where: ['nav.settings', 'settings.look'],
        text: 'new.change.tileOrder',
        names: { settings: 'nav.settings', reset: 'look.orderReset', look: 'settings.look' },
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

export const CHANGES: Change[] = RELEASES.flatMap((release) => release.changes.map((change) => ({ ...change, after: release.after })))

type Version = [number, number, number]

function parse(release: string): Version | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(release)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** The x.y.z a version starts from, so "v2.2.3-4-gabc" gives 2.2.3, or null for one without a number such as "dev". */
export function releaseNumber(version: string): string | null {
  const v = parse(version)
  return v ? v.join('.') : null
}

/** Whether a version is a release itself rather than a build between two tags. */
export function isRelease(version: string): boolean {
  return /^v?\d+\.\d+\.\d+$/.test(version.split('+')[0].trim())
}

/** Orders two release numbers, older first. */
export function compareReleases(a: string, b: string): number {
  const [x, y] = [parse(a) ?? [0, 0, 0], parse(b) ?? [0, 0, 0]]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/**
 * The release that brought a change: the oldest of `releases` past its
 * `after`, or undefined while none is, as in a build of what comes next.
 */
export function broughtBy(change: Change, releases: string[]): string | undefined {
  return releases
    .filter((release) => compareReleases(release, change.after) > 0)
    .sort(compareReleases)[0]
}

/** Whether a path is drawn at a route, segment by segment. */
export function matchRoute(route: string, path: string): boolean {
  const want = route.split('/').filter(Boolean)
  const have = path.split('/').filter(Boolean)
  return want.length === have.length && want.every((part, i) => part.startsWith(':') || part === have[i])
}

/** Whether `here` is one of the addresses a change is drawn at. */
export function isAt(change: PlacedChange, here: string): boolean {
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
export function goOf(change: PlacedChange): string {
  return change.go ?? change.at[0]
}
