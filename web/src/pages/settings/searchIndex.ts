// What the settings search knows: every card on every tab, and the name and
// (i) text of the rows on it, as translation keys, so it searches in the
// reader's language. It is written by hand because the cards take their
// strings from several files; searchIndex.test.ts holds each tab's card
// titles to its page.
import type { TranslationKey } from '../../lib/i18n'
import type { TabId } from '../../lib/routes'

export interface SearchRow {
  key: TranslationKey
  hint?: TranslationKey
}

export interface SearchCard {
  title: TranslationKey
  hint?: TranslationKey
  rows: SearchRow[]
  /** Further text on the card that is searched but never shown as a result. */
  body?: TranslationKey[]
}

const SIDEBAR_ROW: SearchRow = { key: 'settings.showInSidebar', hint: 'settings.showInSidebarHint' }

export const SETTINGS_INDEX: Record<TabId, SearchCard[]> = {
  general: [
    {
      title: 'settings.thisComputer',
      rows: [
        { key: 'window.tray', hint: 'window.trayHint' },
        { key: 'window.close', hint: 'window.closeHint' },
        { key: 'window.minimise', hint: 'window.minimiseHint' },
        { key: 'start.withSystem', hint: 'start.withSystemHint' },
        { key: 'update.auto', hint: 'update.autoHint' },
      ],
    },
    {
      title: 'backup.title',
      hint: 'backup.hint',
      rows: [{ key: 'settings.backupExportRow' }, { key: 'settings.backupImportRow' }],
    },
    {
      title: 'settings.workload',
      rows: [
        { key: 'engine.bwlimit', hint: 'engine.bwlimitHint' },
        { key: 'engine.parallel', hint: 'engine.parallelHint' },
        { key: 'engine.history', hint: 'engine.historyHint' },
      ],
    },
  ],
  look: [
    {
      title: 'look.appearance',
      rows: [
        { key: 'look.language' },
        { key: 'look.design' },
        { key: 'look.corners', hint: 'look.cornersHint' },
        { key: 'look.motion', hint: 'look.motionHint' },
      ],
    },
    {
      title: 'look.labels',
      hint: 'look.labelsHint',
      rows: [
        { key: 'look.labelsButtons' },
        { key: 'look.labelsSidebar' },
        { key: 'look.labelsTabs' },
        { key: 'look.barLabels', hint: 'look.barLabelsWeb' },
      ],
    },
    {
      title: 'look.colors',
      rows: [
        { key: 'look.accent' },
        { key: 'look.rainbowOn', hint: 'look.rainbowHint' },
        { key: 'look.rainbowReactive', hint: 'look.reactiveHint' },
        { key: 'look.rainbowRotate', hint: 'look.rotateHint' },
        { key: 'look.palette', hint: 'look.paletteHint' },
      ],
    },
  ],
  sync: [
    {
      title: 'engine.defaults',
      hint: 'settings.syncHint',
      rows: [
        { key: 'direction.label', hint: 'defaults.followHint' },
        { key: 'mode.label', hint: 'mode.onlyOneWay' },
        { key: 'edit.schedule', hint: 'edit.scheduleHint' },
      ],
    },
    {
      title: 'settings.transfer',
      rows: [
        { key: 'engine.transfers', hint: 'engine.transfersHint' },
        { key: 'edit.quietPeriod', hint: 'edit.quietHint' },
        { key: 'engine.modWindow', hint: 'engine.modWindowHint' },
      ],
    },
    {
      title: 'settings.contents',
      rows: [
        { key: 'edit.emptyDirs', hint: 'edit.emptyDirsHint' },
        { key: 'edit.metadata', hint: 'edit.metadataHint' },
        { key: 'engine.foldCase', hint: 'engine.foldCaseHint' },
      ],
    },
    {
      title: 'workload.retries',
      hint: 'retry.hint',
      rows: [
        { key: 'retry.attempts', hint: 'retry.attemptsHint' },
        { key: 'retry.wait', hint: 'retry.waitHint' },
      ],
    },
    { title: 'engine.sets', hint: 'engine.setsHint', rows: [] },
  ],
  safety: [
    {
      title: 'safety.brakes',
      rows: [
        { key: 'engine.brakePercent', hint: 'engine.brakePercentHint' },
        { key: 'engine.changePercent', hint: 'engine.changePercentHint' },
        { key: 'engine.brakeFloor', hint: 'engine.brakeFloorHint' },
      ],
    },
    {
      title: 'nav.anomalies',
      rows: [
        { key: 'nav.anomalies', hint: 'anomaly.moduleHint' },
        { key: 'anomaly.failingAfter', hint: 'anomaly.failingAfterHint' },
        { key: 'anomaly.overdueDays', hint: 'anomaly.overdueDaysHint' },
        { key: 'anomaly.unusual', hint: 'anomaly.unusualHint' },
        { key: 'anomaly.notifyHeld', hint: 'anomaly.notifyHeldHint' },
        { key: 'anomaly.notifyNotes', hint: 'anomaly.notifyNotesHint' },
      ],
    },
    {
      title: 'settings.notifications',
      rows: [
        { key: 'engine.onSuccess', hint: 'engine.onSuccessHint' },
        { key: 'notify.matrix', hint: 'engine.matrixHint' },
        { key: 'engine.matrixHome' },
        { key: 'engine.matrixRoom' },
        { key: 'engine.matrixToken' },
        { key: 'engine.webhook', hint: 'engine.webhookHint' },
      ],
    },
  ],
  targets: [{ title: 'nav.targets', rows: [SIDEBAR_ROW] }],
  security: [
    { title: 'login.password', hint: 'password.hint', rows: [] },
    { title: 'twoFactor.title', hint: 'twoFactor.hint', rows: [] },
    { title: 'passkey.title', hint: 'passkey.hint', rows: [] },
  ],
  apps: [
    { title: 'apps.serverTitle', hint: 'apps.serverHint', rows: [] },
    { title: 'apps.desktopTitle', hint: 'apps.desktopHint', rows: [] },
    { title: 'apps.phoneTitle', hint: 'apps.phoneHint', rows: [] },
  ],
  info: [
    {
      title: 'about.version',
      hint: 'info.versionHint',
      rows: [{ key: 'info.check' }],
      body: ['info.glimstoneSub', 'info.rcloneSub'],
    },
    {
      title: 'info.help',
      hint: 'info.helpHint',
      rows: [{ key: 'info.manual' }, { key: 'info.bugReport' }],
      body: ['about.report'],
    },
    { title: 'about.title', rows: [], body: ['about.body'] },
  ],
}
