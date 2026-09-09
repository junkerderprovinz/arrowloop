// Translation, forty-two languages, with English and German inline as the two
// sources of truth.
//
// The other forty arrive one chunk at a time. Bundling them all would put
// forty-one languages nobody is reading into the download of every visitor, and
// translations are the one part of an interface where that waste is certain
// rather than likely. English stays static because it is the fallback behind
// every missing key, and a fallback that has to be fetched is not a fallback.

import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'


// import.meta.glob rather than forty hand-written arrow functions: Vite
// resolves the pattern at build time, so adding a language is adding a file,
// and a map that has to be edited in step is a map that will not be.
const localeChunks = import.meta.glob<{ default: Partial<Translations> }>('./locales/*.ts')

const loaded: Record<string, Partial<Translations>> = {}

/** The table for one language, fetching its chunk the first time. */
export async function loadLocale(code: string): Promise<Partial<Translations>> {
  if (loaded[code]) return loaded[code]
  const chunk = localeChunks[`./locales/${code}.ts`]
  if (!chunk) return {}
  try {
    const mod = await chunk()
    loaded[code] = mod.default
    return mod.default
  } catch {
    // A chunk that never arrives, because the machine is offline or a stale
    // page is asking for a hash that no longer exists, must not take the
    // interface down with it. English is a worse experience than the language
    // somebody chose and a far better one than a blank page.
    return {}
  }
}

// ---------------------------------------------------------------------------
// The key set. English is the source of truth and every other table is checked
// against it by i18n.parity.test.ts.
//
// Every sentence with a number in it is written count-neutral, with the number
// at the end. A one-and-other split looks correct and is not: languages whose
// plural rules select "few" or "many" look for a suffix that split never
// writes, and fall through to English in the middle of an otherwise translated
// page, at exactly the commonest counts.
// ---------------------------------------------------------------------------

export const en = {
  'nav.jobs': 'Jobs',
  'nav.targets': 'Targets',
  'nav.history': 'History',
  'nav.settings': 'Settings',
  'settings.section': 'Settings section',
  'settings.general': 'General',
  'settings.look': 'Look',
  'settings.engine': 'Engine',
  'engine.title': 'Engine',
  'engine.saving': 'Saving…',
  'engine.savedLive': 'Saved',
  'engine.loading': 'Reading the settings…',
  'engine.work': 'How hard it may work',
  'engine.bwlimit': 'Bandwidth limit',
  'engine.bwlimitHint': 'How fast this program is allowed to transfer, so a sync cannot take the whole line and make everything else on the network unusable while it runs. Leave it empty unless that actually happens: empty means full speed, which is what you want on a local disk or a fast network. If a run does make video calls stutter, set roughly four fifths of your upload speed, written as 1M or 512k. It also takes a timetable, so it can be throttled by day and unlimited at night: 08:00,512k 19:00,off. One limit for the whole program, because two jobs on one machine share one line.',
  'engine.parallel': 'Jobs at once',
  'engine.parallelHint': 'One at a time by default, and that is a decision rather than a limitation: two jobs running together share one line and one disk, so they mostly slow each other down while making the log harder to read.',
  'engine.memory': 'What it remembers',
  'engine.history': 'Run log file',
  'engine.historyHint': 'Where every run is written down, with what it did to which file. Empty means beside the configuration file. A relative name is relative to that same folder.',
  'engine.telling': 'Who gets told',
  'engine.defaults': 'What every job starts from',
  'backup.title': 'Back up your settings',
  'engine.sets': 'Shared exclude lists',
  'engine.setsHint': 'A list written once and asked for by name, instead of the same twenty lines pasted into every job and then drifting apart. A job that asks for a list that does not exist is refused when the file is read, because a filter that silently matches nothing does not break anything: it just quietly syncs the thing you asked it to leave alone.',
  'backup.hint': 'One file holds every job and every setting. Keep it somewhere else and a new machine is one restore away rather than an evening of retyping.',
  'backup.export': 'Export settings',
  'backup.import': 'Import settings',
  'backup.confirm': 'Replace every job and every setting with {file}? The setup on this machine goes, and it does not come back unless you have a copy of it.',
  'edit.duplicate': 'Duplicate',
  'edit.copySuffix': 'copy',
  'history.download': 'Save this list',
  'stats.runs': '{count} runs',
  'stats.copied': '{count} copied',
  'stats.trashed': '{count} to the bin',
  'stats.conflicts': '{count} conflicts',
  'stats.failed': '{count} failed',
  'stats.window': 'the last {days} days',
  'engine.brakePercent': 'Mass-delete brake',
  'engine.brakePercentHint': 'A run that would remove more than this share of everything it knows about stops and says so, instead of doing it. Fifty by default. Zero switches it off entirely, which is a thing to type on purpose and not to arrive at by leaving a field empty.',
  'engine.brakeFloor': 'Below this many files, no brake',
  'engine.brakeFloorHint': 'The brake works on a share, and a share is meaningless when there is almost nothing there: two files out of three is 67 per cent and perfectly normal. Below this count it stays out of the way. Ten by default.',
  'engine.transfers': 'Files at once',
  'engine.transfersHint': 'How many files one job moves at the same time. More is faster on a fast line and slower on a slow disk, because the head spends its time seeking rather than reading.',
  'engine.modWindow': 'Timestamp tolerance',
  'engine.foldCase': 'Upper and lower case',
  'engine.foldCaseHint': 'Whether Bild.jpg and bild.jpg count as one file. Normally the two sides are asked and folding happens when either of them cannot tell the two apart. Set it by hand when a side lies about itself, which happens: a share exported from Windows and mounted on Linux reports itself case-sensitive and is not, and left wrong the two sides each keep their own copy of one file, for ever.',
  'engine.foldAuto': 'Ask the sides',
  'engine.foldOn': 'Always one file',
  'engine.foldOff': 'Always two',
  'engine.modWindowHint': 'How far two modification times may differ and still count as the same. Some filesystems keep whole seconds and some keep nanoseconds, so a file copied between them can look changed when nothing about it is. Written as a duration: 1s, 2s. Empty means exact.',
  'engine.matrixHome': 'Matrix homeserver',
  'engine.matrixHint': 'Where a finished run reports to. Leave all three empty and nothing is sent.',
  'engine.matrixRoom': 'Matrix room',
  'engine.matrixToken': 'Matrix access token',
  'engine.webhook': 'Webhook',
  'engine.webhookHint': 'An address a finished run posts to, for anything that is not Matrix. Empty means nothing is sent.',
  'engine.onSuccess': 'Report successful runs too',
  'engine.onSuccessHint': 'Off by default, so a message means something went wrong. Turned on, a quiet week reads the same as a broken one, because both are silence.',
  'settings.about': 'About',
  'schedule.off': 'Manual',
  'schedule.every': 'Every N',
  'schedule.everyLabel': 'Every',
  'schedule.unit.minute': 'minutes',
  'schedule.unit.hour': 'hours',
  'schedule.unit.day': 'days',
  'schedule.unit.week': 'weeks',
  'schedule.daily': 'Every day',
  'schedule.weekly': 'Weekdays',
  'schedule.cron': 'Cron',
  'schedule.live': 'Real time',
  'schedule.settleHint': 'How long nothing may happen in the folder before real time starts a run. Copy fifty files into it and the system reports fifty changes, so with no wait that is fifty runs, and the first forty-nine sync a half-filled folder. Five seconds covers everyday use, a minute is better for large files over a network.',
  'schedule.settle': 'Settle time',
  'schedule.backstop': 'Backstop',
  'schedule.backstopHint': 'How often the job also runs by the clock, even when nothing seems to have happened. Only the side that lives on this machine can be watched, and an event the watcher misses never reports itself later: a server, a network share or a machine that was switched off changes files without anything arriving here. The backstop is the run that finds it anyway. An hour is usually right.',
  'jobs.runs': 'runs {cadence}',
  'jobs.lastRun': 'last run {when}',
  'jobs.activity': 'Activity',
  'jobs.activityEmpty': 'Nothing yet. This job has not run.',
  'jobs.cadence.live': 'in real time',
  'jobs.cadence.every': 'every {n} {unit}',
  'jobs.cadence.everyOne.minute': 'every minute',
  'jobs.cadence.everyOne.hour': 'hourly',
  'jobs.cadence.everyOne.day': 'daily',
  'jobs.cadence.everyOne.week': 'weekly',
  'jobs.cadence.daily': 'daily at {time}',
  'jobs.cadence.weekly': '{days} at {time}',
  'jobs.cadence.cron': 'on {expression}',
  'schedule.at': 'At',
  'schedule.days': 'Days',
  'schedule.day.mon': 'Mon',
  'schedule.day.tue': 'Tue',
  'schedule.day.wed': 'Wed',
  'schedule.day.thu': 'Thu',
  'schedule.day.fri': 'Fri',
  'schedule.day.sat': 'Sat',
  'schedule.day.sun': 'Sun',
  'edit.editJob': 'Edit',
  'edit.removeJob': 'Remove this job',
  'edit.removeStakes': 'The job {name} is taken out of the configuration. What it has already copied stays exactly where it is on both sides; nothing is deleted from your folders.',
  'edit.removeState': 'Delete its state database too',
  'edit.removeStateHint': 'The record of what both sides last agreed on. Keep it only if the same pair is coming back, so the next run does not treat every file as new.',
  'pick.cancel': 'Cancel',
  'pick.title': 'Choose a folder',
  'pick.open': 'Browse for a folder',
  'pick.choose': 'Use this folder',
  'pick.up': 'One level up',
  'pick.newFolder': 'New folder',
  'pick.create': 'Create',
  'pick.roots': 'Drives and roots',
  'pick.empty': 'No folders in here.',
  'look.paletteReset': 'Back to the house colours',
  'look.accentReset': 'Back to the default',
  'error.unreachable': 'Cannot reach the engine',
  'login.title': 'This interface is protected',
  'login.password': 'Password',
  'login.submit': 'Log in',
  'login.wrong': 'That password is not right.',
  'login.locked': 'Too many attempts. Wait a minute and try again.',
  'login.logout': 'Log out',

  // Jobs
  'jobs.title': 'Jobs',
  'jobs.empty': 'No jobs are configured yet. Add one on the Edit tab.',
  'jobs.preview': 'Preview',
  'jobs.state.running': 'running',
  'jobs.state.disabled': 'disabled',
  'jobs.state.failed': 'last run failed',
  'jobs.state.idle': 'ready',
  'jobs.pause': 'Pause',
  'jobs.resume': 'Resume',
  'jobs.runNow': 'Run now',
  'jobs.runNowHint': 'Start this job straight away, without a preview. The same safety nets apply: nothing is deleted outright, and a run that would remove more than half of everything it knows about stops and says so.',
  'jobs.check': 'Check this job',
  'check.healthy': 'Nothing to report. Both sides are reachable and the record matches what is there.',
  'check.more': '{found} findings in total, showing the first {shown}.',
  'jobs.schedule.onRequest': 'on request',
  'jobs.ago': 'ago',

  // Units of elapsed time, written out because an abbreviation that reads
  // naturally in English rarely does anywhere else.
  'time.second': 'seconds',
  'time.minute': 'minutes',
  'time.hour': 'hours',
  'time.day': 'days',
  'preview.title': 'Preview',
  'preview.for': 'Preview: {job}',
  'preview.working': 'Working out what would happen. Nothing has been touched.',
  'preview.nothing': 'Both sides already agree. There is nothing to do.',
  'preview.run': 'Run {chosen} of {total}',
  'preview.starting': 'Starting',
  'preview.unchanged': 'Unchanged: {count}',
  'preview.identical': 'Already identical on both sides: {count}',
  'preview.skipped': 'Left for later',
  'preview.explain':
    'Nothing moves until you press the button. Untick a row to leave it exactly as it is.',

  'kind.copy': 'copy',
  'kind.move': 'move',
  'kind.delete': 'delete',
  'kind.conflict': 'conflict',
  'kind.mkdir': 'new folder',
  'kind.rmdir': 'remove folder',

  'direction.label': 'Direction',
  'direction.both': 'Both ways',
  'direction.toRight': 'Only to the right',
  'direction.toLeft': 'Only to the left',
  'direction.hint':
    'Both sides are always compared, because comparing is how a change is found. The direction decides what may be done about it: one way makes one side the source, never writes to it, and puts its version back over anything the other side changed. A file the source has never had is left where it is, so this copies rather than mirrors.',
  'side.left': 'left',
  'side.right': 'right',

  // Conflicts
  'conflict.title': 'Both sides changed this file',
  'conflict.keepBoth': 'Keep both',
  'conflict.keepLeft': 'Keep left',
  'conflict.keepRight': 'Keep right',
  'conflict.keepBothHint':
    'The newer version keeps the plain name on both sides and the older one is preserved next to it. Nothing is lost.',
  'conflict.chosenHint':
    'The version you did not pick goes to the trash on its own side, where you can still get it back.',
  'conflict.newer': 'newer',
  'conflict.size': 'Size',
  'conflict.changed': 'Changed',
  'conflict.missing': 'not there',

  // History
  'history.title': 'History',
  'history.empty': 'Nothing has run yet.',
  'history.loading': 'Reading what this run did…',
  'history.nothing': 'This run found nothing to do.',
  'history.conflictHint': 'A scheduled run keeps both versions, because it has nobody to ask. Choose here and a fresh run applies just these paths; what the run above did stays on the record.',
  'history.applyChoices': 'Apply these choices',
  'entry.copy': 'copied',
  'entry.move': 'moved',
  'entry.trash': 'to the bin',
  'trash.side': 'Which side',
  'trash.empty': 'Nothing in the bin on this side.',
  'trash.restore': 'Put this file back',
  'trash.restored': '{path} is back where it was.',
  'trash.unknownAge': 'age unknown',
  'trash.more': '{total} in the bin, showing {shown}.',
  'trash.days': 'Older than, in days',
  'trash.prune': 'Empty out the old ones',
  'trash.pruneConfirm': 'Permanently remove everything in the bin older than {days} days? This is the one thing here that cannot be undone, because the bin is what it is emptying.',
  'trash.pruned': '{entries} removed from the bin.',
  'entry.conflict': 'conflict',
  'entry.mkdir': 'folder made',
  'entry.rmdir': 'folder removed',
  'entry.skip': 'left alone',
  'entry.other': 'did',
  'history.ok': 'ok',
  'history.failed': 'failed',
  'history.copied': 'copied: {count}',
  'history.moved': 'moved: {count}',
  'history.trashed': 'trashed: {count}',
  'history.conflicts': 'conflicts: {count}',
  'history.left': 'left for later: {count}',

  // Editor
  'edit.add': 'Add a job',
  'edit.remove': 'Remove',
  'edit.save': 'Save',
  'edit.name': 'Name',
  'edit.left': 'Left side',
  'edit.right': 'Right side',
  'edit.state': 'State file',
  'edit.schedule': 'Schedule',
  'edit.exclude': 'Exclusions',
  'sets.none': 'No shared lists yet.',
  'sets.noneYet': 'No shared lists are defined yet. They are set up in Settings, under Engine.',
  'sets.add': 'Add this list',
  'sets.remove': 'Remove this list',
  'sets.newName': 'Name for a new list',
  'edit.emptyDirs': 'Carry empty folders',
  'edit.metadata': 'Carry permissions and ownership',
  'edit.quietPeriod': 'Quiet period',
  'edit.quietUnit': 'Unit',
  'edit.quiet.s': 'Seconds',
  'edit.quiet.m': 'Minutes',
  'edit.quiet.h': 'Hours',
  'edit.nameHint': 'How this job is named in the list, the log and the notifications.',
  'edit.sideHint':
    'A folder, a configured target as name:path, or a drive registered on the Targets tab.',
  'edit.stateHint':
    'Where this job remembers what the two sides last agreed on. One file per job, and losing it is not destructive but it is disruptive.',
  'edit.scheduleHint': 'When this job runs by itself. Manual means only when you start it from its card. Real time reacts to a change within seconds. Every N, daily and weekly keep to the clock. Expression is for a rhythm the pickers cannot say: written as cron, read in this machine timezone.',
  'edit.excludeHint':
    'One pattern per line. Names of half-written files are always excluded, whatever is here.',
  'edit.firstRun': 'The first run',
  'edit.firstRunHint': 'The first run is the one that decides everything, and until now it was the one nobody was asked about. With no record yet, every file on both sides counts as new, so everything on the left arrives on the right and the other way round. Choose a side instead and that side wins every disagreement, while a file it never had is left exactly where it is: seeding is copying, not mirroring. This applies once. As soon as a record exists the setting is ignored.',
  'edit.firstRun.merge': 'Merge both sides',
  'edit.firstRun.left': 'The left side is right',
  'edit.firstRun.right': 'The right side is right',
  'edit.excludeSets': 'Shared lists',
  'edit.excludeSetsHint': 'Lists defined once in the settings. What you pick here is added to this job\'s own patterns below rather than replacing them.',
  'edit.quietHint': 'How long a single file has to sit unchanged before a run touches it. It stops a half-written file from being copied mid-write. Five seconds is the default, and empty means straight away. Not the settle time real time uses: that one counts for the whole folder.',
  'edit.runAtStart': 'Sync as soon as the program starts',
  'edit.runAtStartHint':
    'Runs this job once at every start, before its schedule is next due. A machine that was off overnight missed its turn, and without this the two sides stay apart until tomorrow.',
  'edit.emptyDirsHint':
    'A folder with files in it travels anyway. An empty one has nothing to imply it, so it needs a record of its own. Off for a bucket, which has no real folders.',
  'edit.metadataHint':
    'Permissions, ownership and extended attributes travel with the bytes, wherever both sides can store them.',
  'edit.unnamed': 'unnamed',
  'edit.savedNote': 'Saved. The schedules and the watchers were rebuilt.',
  'edit.checking': 'Checking',
  'edit.unsaved': 'not saved yet',
  'edit.newJob': 'new-job',
  'edit.pickDrive': 'A registered drive',
  'edit.pickRemote': 'A configured target',
  'targets.storage': 'Storage',
  'targets.storageEmpty': 'No storage targets yet. Add one to reach an S3 bucket, an SSH host or a Windows share.',
  'targets.addStorage': 'Add storage',
  'targets.remoteName': 'Name',
  'targets.remoteNameHint':
    'How you will refer to this target in a job, written as name:path. No spaces, no colons.',
  'targets.kind': 'Kind',
  'targets.check': 'Check',
  'targets.checking': 'Checking',
  'targets.checkOk': 'Reached it',
  'targets.checkFailed': 'Could not reach it',
  'targets.checkHint':
    'Saving a credential proves nothing. This opens the target and lists it, which is the only way to know the settings are right.',
  'targets.delete': 'Delete',
  'targets.edit': 'Edit',
  'targets.cancel': 'Cancel',
  'targets.save': 'Save',
  'targets.secretSet': 'A value is stored. Leave this alone to keep it.',
  'targets.advanced': 'Show every setting',
  'targets.required': 'required',
  'confirm.deleteRemote': 'Delete this storage target',
  'confirm.deleteRemoteStakes':
    'The settings for {name} are removed from the rclone configuration, including any password or key stored with them. Nothing is copied anywhere first, and there is no undo: setting it up again means typing the credentials again. Jobs pointing at it will fail on their next run until they are pointed somewhere else.',
  'confirm.delete': 'Delete it',
  'confirm.cancel': 'Cancel',
  'about.title': 'About ArrowLoop',
  'about.body':
    'A one-knight crusade: free, open-source tools that did not exist in this shape. No accounts, no telemetry, and nothing readable ever leaves your own walls. Forged on evenings and weekends with a lot of heart, because waiting was not an option.',
  'about.coffee':
    'ArrowLoop is free and stays free. A donation keeps the project alive and covers what it costs: the domain, the server, and the evenings that go into it.',
  'about.coffeeButton': 'Buy me a coffee',
  'about.report': 'Problems, wishes or suggestions? Open an issue on GitHub, or send an email.',
  'about.version': 'Version',
  'about.unreleased': '{version}, not a released build',
  'about.repo': 'GitHub',
  'about.mail': 'Send an email',
  'about.mailSubject': 'Feedback',
  'secret.show': 'Show',
  'secret.hide': 'Hide',

  // Targets: drives
  'targets.drives': 'Drives',
  'targets.drivesEmpty':
    'No drives are registered. Register one so a job can find it again after it comes back on another letter.',
  'targets.driveExplain':
    'A drive letter is not an identity: the disk that was one letter last week can be another today, and that letter can by then belong to something else. Registering writes a small marker on the drive itself, so a job follows the disk rather than the letter. This works for a network share too.',
  'targets.registerDrive': 'Register a drive',
  'targets.driveLabel': 'Name',
  'targets.driveLabelHint': 'What you call this disk. It is what you will see when it is not plugged in.',
  'targets.driveMount': 'Where it is now',
  'targets.attached': 'attached',
  'targets.absent': 'not attached',
  'targets.forget': 'Forget',
  'targets.forgetHint':
    'Removes the note that this drive was ever here. The marker on the drive is left alone, so plugging it in again brings it straight back.',
  'targets.lastSeen': 'Last seen',
  'targets.noCandidates': 'Nothing to register. Plug a drive in or mount a share, then look again.',
  'targets.copyPath': 'Copy the job path',
  'targets.copied': 'Copied',

  // Look
  'look.theme': 'Theme',
  'look.dark': 'Dark',
  'look.light': 'Light',
  'look.corners': 'Corners',
  'look.cornersHint':
    'How round every corner in the app is. The cards, the buttons, the fields and the switches all follow this one setting.',
  'look.round': 'Round',
  'look.soft': 'Soft',
  'look.square': 'Square',
  'look.colors': 'Colours',
  'look.accent': 'Accent color',
  'look.rainbowOn': 'Rainbow Mode',
  'look.rainbowReactive': 'Reactive Mode',
  'look.rainbowRotate': 'Colour Rotation',
  'look.rainbowHint':
    'Gives each card its own colour from one palette instead of one accent everywhere.',
  'look.reactiveHint': 'Builds the palette around the accent you picked, rather than a fixed one.',
  'look.rotateHint': 'Moves the palette along by one on every visit.',
  'look.palette': 'Colour palette',
  'look.paletteHint': 'Each colour can be changed. A click opens the picker on it.',
  'look.motion': 'Motion',
  'look.motionHint': 'How much the interface moves. It never overrides what your system asks for, it only dials down from there.',
  'look.motionOff': 'Off',
  'look.motionSubtle': 'Subtle',
  'look.motionFull': 'Full',
  'look.labels': 'Labels',
  'look.labelsHint': 'Whether controls show their words, their glyph, or both. The width does not change, so switching never moves the page.',
  'look.labelsButtons': 'Buttons',
  'look.labelsSidebar': 'Sidebar',
  'look.labelsTabs': 'Tabs',
  'look.labelText': 'Text',
  'look.labelTextGlyph': 'Text and symbol',
  'look.labelGlyph': 'Symbol',
  'look.labelReactive': 'Reactive',
  'look.language': 'Language',

  // Progress

  // The engine's own reasons, keyed by the code it sends. The engine words them
  // in English as well and the interface falls back to that sentence for a code
  // it has never heard of: an explanation in the wrong language is worth more
  // than a dotted identifier.
  'reason.newOnSide': 'new on the {side}',
  'reason.changedOnSide': 'changed on the {side}',
  'reason.changedBothSame': 'changed on both sides to the same content',
  'reason.changedBoth': 'changed on both sides',
  'reason.deletedOnSide': 'deleted on the {side}',
  'reason.restoredOnSide': 'edited on the {side} after being deleted on the {other}, restoring it',
  'reason.renamedOnSide': 'renamed on the {side}',
  'reason.collision': 'the {side} side holds {names}, which the other side may not be able to tell apart; rename one of them',
  'reason.settling': 'changed on the {side} less than {period} ago, waiting for it to settle',
  'reason.goneBoth': 'gone on both sides, dropping the record',
  'reason.appearedSame': 'appeared on both sides with identical content',
  'reason.appearedDiffer': 'appeared on both sides with different content',
  'reason.dirBoth': 'on both sides',
  'reason.dirNewOnSide': 'new folder on the {side}',
  'reason.dirRemovedOnSide': 'folder removed on the {side}',
  'reason.dirGoneBoth': 'folder gone on both sides, dropping the record',
  'reason.stepFailed': '{what} failed, leaving it for the next run: {error}',
  'reason.removeDirFailed': 'the folder could not be removed, leaving it: {error}',
  'reason.heldOpen': 'another program is holding it open on the {side}, waiting for it to be closed',
  'reason.unsupported': '{kind} on the {side}, which this engine does not carry',
  'reason.recordFailed': 'the record could not be written, leaving it for the next run: {error}',

  'window.title': 'Window',
  'window.tray': 'Icon in the notification area',
  'window.trayHint':
    'Keeps ArrowLoop reachable while the window is away. Without it there is nowhere for the two settings below to send the window, so they turn off with it.',
  'window.close': 'The close button hides the window',
  'window.closeHint':
    'Off by default, because a close button that does not close is a surprise, and one that hides a running program is the kind somebody finds a week later wondering why a job keeps running.',
  'window.minimise': 'Minimising goes to the notification area',
  'window.minimiseHint': 'Instead of the taskbar. The window comes back from the icon either way.',

  'start.title': 'Starting',
  'start.withSystem': 'Start with the system',
  'start.withSystemHint':
    'ArrowLoop starts when you sign in, so a scheduled job runs without anybody opening the window first. The entry is yours alone and asks for no administrator rights.',

  'progress.of': '{done} of {total}',
  'progress.starting': 'Starting',
  'progress.rate': '{rate} files/s',
  'progress.left': '{time} left',
  'jobs.previewHint': 'Work out what this job would do without changing anything, then tick or untick each change before it runs.',
  'preview.back': 'Back',
  'preview.backHint': 'Leave the preview without running anything. Escape does the same.',
  'history.filterJob': 'Job',
  'history.allJobs': 'All jobs',
  'history.filterShow': 'Show',
  'history.showAll': 'Every run',
  'history.showChanged': 'Only runs that did something',
  'history.showFailed': 'Only failures',
  'history.filterHint': 'A job watching a folder writes an entry every time something changes, so one running every minute pushes a job that runs once a day off the page entirely. Narrowing here asks the engine for a different set of runs rather than hiding part of the ones already fetched, so the job you are looking for comes back even when its last run was a thousand entries ago. A failed run always counts as one that did something.',
  'history.working': 'Looking.',
  'history.noMatch': 'No run matches this.',
  'edit.trash': 'Keep a bin on each side',
  'edit.trashHint': 'A deletion becomes a move into a hidden folder called .arrowloop inside the synced tree, so nothing this job does destroys anything outright and a file removed by mistake can be fetched back from the trash tab. That folder is visible to everyone using the share, which is the reason to switch this off: with no bin it is never created, a deletion is final, and so is the losing side of a conflict. Reasonable for a folder of downloads, a bad idea for a folder of documents.',
  'jobs.activityLoading': 'Reading what this job has done.',
  'history.more': 'Show more',
  'trash.holding': '{count} in the bin, {size}',
} as const

export type TranslationKey = keyof typeof en
export type Translations = Record<TranslationKey, string>

export const de: Translations = {
  'nav.jobs': 'Aufträge',
  'nav.targets': 'Ziele',
  'nav.history': 'Verlauf',
  'nav.settings': 'Einstellungen',
  'settings.section': 'Einstellungsbereich',
  'settings.general': 'Allgemein',
  'settings.look': 'Aussehen',
  'settings.engine': 'Motor',
  'engine.title': 'Motor',
  'engine.saving': 'Speichert…',
  'engine.savedLive': 'Gespeichert',
  'engine.loading': 'Lese die Einstellungen…',
  'engine.work': 'Wie hart er arbeiten darf',
  'engine.bwlimit': 'Bandbreitenlimit',
  'engine.bwlimitHint': 'Wie schnell dieses Programm übertragen darf, damit ein Abgleich nicht die ganze Leitung nimmt und währenddessen alles andere im Netz unbrauchbar macht. Lass es leer, solange das nicht passiert: leer heißt volle Geschwindigkeit, und das willst du auf einer lokalen Platte oder im schnellen Netz. Wenn ein Lauf tatsächlich Videoanrufe stocken lässt, stell etwa vier Fünftel deiner Upload-Geschwindigkeit ein, geschrieben als 1M oder 512k. Es nimmt auch eine Zeittabelle, also tagsüber gedrosselt und nachts offen: 08:00,512k 19:00,off. Ein Limit für das ganze Programm, denn zwei Aufträge auf einem Rechner teilen sich eine Leitung.',
  'engine.parallel': 'Aufträge gleichzeitig',
  'engine.parallelHint': 'Standardmäßig einer nach dem anderen, und das ist eine Entscheidung und keine Beschränkung: zwei gleichzeitig laufende Aufträge teilen sich eine Leitung und eine Platte, bremsen sich also meistens gegenseitig aus und machen das Protokoll unübersichtlicher.',
  'engine.memory': 'Woran er sich erinnert',
  'engine.history': 'Datei für das Laufprotokoll',
  'engine.historyHint': 'Wohin jeder Lauf geschrieben wird, samt dem, was er mit welcher Datei gemacht hat. Leer heißt neben die Konfigurationsdatei. Ein relativer Name bezieht sich auf denselben Ordner.',
  'engine.telling': 'Wer Bescheid bekommt',
  'engine.defaults': 'Wovon jeder Auftrag ausgeht',
  'backup.title': 'Einstellungen sichern',
  'engine.sets': 'Gemeinsame Ausschlusslisten',
  'engine.setsHint': 'Eine Liste, die du einmal schreibst und danach beim Namen aufrufst, statt dieselben zwanzig Zeilen in jeden Auftrag zu kopieren, wo sie dann auseinanderlaufen. Ein Auftrag, der eine Liste verlangt, die es nicht gibt, wird schon beim Lesen der Datei abgelehnt, denn ein Filter, der stillschweigend auf nichts passt, geht nicht kaputt: Er gleicht in aller Ruhe genau das ab, was du in Ruhe lassen wolltest.',
  'backup.hint': 'Eine Datei enthält alle Aufträge und alle Einstellungen. Leg sie woanders ab, dann ist ein neuer Rechner ein Einspielen entfernt statt ein Abend Abtippen.',
  'backup.export': 'Einstellungen exportieren',
  'backup.import': 'Einstellungen importieren',
  'backup.confirm': 'Alle Aufträge und alle Einstellungen durch {file} ersetzen? Die Einrichtung auf diesem Rechner ist dann weg, und sie kommt nur zurück, wenn du eine Kopie davon hast.',
  'edit.duplicate': 'Duplizieren',
  'edit.copySuffix': 'Kopie',
  'history.download': 'Diese Liste sichern',
  'stats.runs': 'Läufe: {count}',
  'stats.copied': 'kopiert: {count}',
  'stats.trashed': 'in den Papierkorb: {count}',
  'stats.conflicts': 'Konflikte: {count}',
  'stats.failed': 'fehlgeschlagen: {count}',
  'stats.window': 'die letzten {days} Tage',
  'engine.brakePercent': 'Massenlösch-Bremse',
  'engine.brakePercentHint': 'Ein Lauf, der mehr als diesen Anteil aller bekannten Dateien entfernen würde, bricht ab und sagt es, statt es zu tun. Standard ist fünfzig. Null schaltet sie ganz ab, und das soll man absichtlich tippen und nicht durch ein leeres Feld erreichen.',
  'engine.brakeFloor': 'Unter so vielen Dateien keine Bremse',
  'engine.brakeFloorHint': 'Die Bremse rechnet mit einem Anteil, und ein Anteil sagt nichts, wenn fast nichts da ist: zwei von drei Dateien sind 67 Prozent und völlig normal. Unter dieser Anzahl hält sie sich raus. Standard ist zehn.',
  'engine.transfers': 'Dateien gleichzeitig',
  'engine.transfersHint': 'Wie viele Dateien ein Auftrag gleichzeitig bewegt. Mehr ist schneller auf einer schnellen Leitung und langsamer auf einer langsamen Platte, weil der Kopf dann sucht statt zu lesen.',
  'engine.modWindow': 'Zeitstempel-Toleranz',
  'engine.foldCase': 'Groß- und Kleinschreibung',
  'engine.foldCaseHint': 'Ob Bild.jpg und bild.jpg als eine Datei gelten. Normalerweise werden die beiden Seiten gefragt, und gefaltet wird, sobald eine von beiden die zwei nicht auseinanderhalten kann. Von Hand setzen, wenn eine Seite über sich selbst lügt, und das kommt vor: eine von Windows exportierte Freigabe, unter Linux eingehängt, meldet sich als schreibungsempfindlich und ist es nicht. Falsch stehengelassen behält jede Seite ihre eigene Kopie derselben Datei, für immer.',
  'engine.foldAuto': 'Seiten fragen',
  'engine.foldOn': 'Immer eine Datei',
  'engine.foldOff': 'Immer zwei',
  'engine.modWindowHint': 'Wie weit zwei Änderungszeiten auseinanderliegen dürfen und trotzdem als gleich gelten. Manche Dateisysteme merken sich ganze Sekunden, andere Nanosekunden, also kann eine dazwischen kopierte Datei geändert aussehen, obwohl sich nichts an ihr geändert hat. Als Dauer geschrieben: 1s, 2s. Leer heißt exakt.',
  'engine.matrixHome': 'Matrix-Heimserver',
  'engine.matrixHint': 'Wohin ein fertiger Lauf meldet. Bleiben alle drei leer, wird nichts gesendet.',
  'engine.matrixRoom': 'Matrix-Raum',
  'engine.matrixToken': 'Matrix-Zugangstoken',
  'engine.webhook': 'Webhook',
  'engine.webhookHint': 'Eine Adresse, an die ein fertiger Lauf meldet, für alles außer Matrix. Leer heißt, es wird nichts gesendet.',
  'engine.onSuccess': 'Auch erfolgreiche Läufe melden',
  'engine.onSuccessHint': 'Standardmäßig aus, damit eine Nachricht bedeutet, dass etwas schiefgegangen ist. Eingeschaltet sieht eine ruhige Woche genauso aus wie eine kaputte, denn beides ist Stille.',
  'settings.about': 'Über',
  'schedule.off': 'Manuell',
  'schedule.every': 'Alle N',
  'schedule.everyLabel': 'Alle',
  'schedule.unit.minute': 'Minuten',
  'schedule.unit.hour': 'Stunden',
  'schedule.unit.day': 'Tage',
  'schedule.unit.week': 'Wochen',
  'schedule.daily': 'Täglich',
  'schedule.weekly': 'Wochentags',
  'schedule.cron': 'Cron',
  'schedule.live': 'Echtzeit',
  'schedule.settleHint': 'Wie lange im Ordner nichts mehr passieren darf, bevor Echtzeit einen Lauf startet. Kopierst du fünfzig Dateien hinein, meldet das System fünfzig Änderungen: ohne Wartezeit wären das fünfzig Läufe, und die ersten neunundvierzig gleichen einen halb gefüllten Ordner ab. Fünf Sekunden reichen im Alltag, bei großen Dateien über das Netz eher eine Minute.',
  'schedule.settle': 'Beruhigungszeit',
  'schedule.backstop': 'Rückfallplan',
  'schedule.backstopHint': 'Wie oft der Auftrag zusätzlich nach der Uhr läuft, auch wenn scheinbar nichts passiert ist. Beobachten lässt sich nur die Seite, die auf diesem Rechner liegt, und ein Ereignis, das dabei verloren geht, meldet sich nie von selbst nach: ein Server, eine Netzfreigabe oder ein Rechner, der gerade aus war, ändert Dateien, ohne dass hier etwas ankommt. Der Rückfallplan ist der Lauf, der es trotzdem findet. Eine Stunde passt meistens.',
  'jobs.runs': 'läuft {cadence}',
  'jobs.lastRun': 'zuletzt {when}',
  'jobs.activity': 'Aktivität',
  'jobs.activityEmpty': 'Noch nichts. Dieser Auftrag ist nie gelaufen.',
  'jobs.cadence.live': 'in Echtzeit',
  'jobs.cadence.every': 'alle {n} {unit}',
  'jobs.cadence.everyOne.minute': 'jede Minute',
  'jobs.cadence.everyOne.hour': 'stündlich',
  'jobs.cadence.everyOne.day': 'täglich',
  'jobs.cadence.everyOne.week': 'wöchentlich',
  'jobs.cadence.daily': 'täglich um {time}',
  'jobs.cadence.weekly': '{days} um {time}',
  'jobs.cadence.cron': 'nach {expression}',
  'schedule.at': 'Um',
  'schedule.days': 'Tage',
  'schedule.day.mon': 'Mo',
  'schedule.day.tue': 'Di',
  'schedule.day.wed': 'Mi',
  'schedule.day.thu': 'Do',
  'schedule.day.fri': 'Fr',
  'schedule.day.sat': 'Sa',
  'schedule.day.sun': 'So',
  'edit.editJob': 'Bearbeiten',
  'edit.removeJob': 'Diesen Auftrag entfernen',
  'edit.removeStakes': 'Der Auftrag {name} wird aus der Konfiguration genommen. Was er schon kopiert hat, bleibt auf beiden Seiten genau dort liegen, wo es ist; aus deinen Ordnern wird nichts gelöscht.',
  'edit.removeState': 'Zustandsdatei mitlöschen',
  'edit.removeStateHint': 'Der Datensatz, worauf sich beide Seiten zuletzt geeinigt hatten. Nur behalten, wenn dasselbe Paar wiederkommt, damit der nächste Lauf nicht jede Datei als neu behandelt.',
  'pick.cancel': 'Abbrechen',
  'pick.title': 'Ordner wählen',
  'pick.open': 'Ordner suchen',
  'pick.choose': 'Diesen Ordner nehmen',
  'pick.up': 'Eine Ebene höher',
  'pick.newFolder': 'Neuer Ordner',
  'pick.create': 'Anlegen',
  'pick.roots': 'Laufwerke und Wurzeln',
  'pick.empty': 'Hier liegen keine Ordner.',
  'look.paletteReset': 'Zurück auf die Hausfarben',
  'look.accentReset': 'Zurück auf die Vorgabe',
  'error.unreachable': 'Der Dienst ist nicht erreichbar',
  'login.title': 'Diese Oberfläche ist geschützt',
  'login.password': 'Passwort',
  'login.submit': 'Anmelden',
  'login.wrong': 'Das Passwort stimmt nicht.',
  'login.locked': 'Zu viele Versuche. Warte eine Minute und probier es noch einmal.',
  'login.logout': 'Abmelden',

  'jobs.title': 'Aufträge',
  'jobs.empty': 'Es ist noch kein Auftrag eingerichtet. Lege einen unter Bearbeiten an.',
  'jobs.preview': 'Vorschau',
  'jobs.state.running': 'läuft',
  'jobs.state.disabled': 'abgeschaltet',
  'jobs.state.failed': 'letzter Lauf fehlgeschlagen',
  'jobs.state.idle': 'bereit',
  'jobs.pause': 'Pausieren',
  'jobs.resume': 'Fortsetzen',
  'jobs.runNow': 'Jetzt ausführen',
  'jobs.runNowHint': 'Diesen Auftrag sofort starten, ohne Vorschau. Die Netze bleiben dieselben: nichts wird endgültig gelöscht, und ein Lauf, der mehr als die Hälfte aller bekannten Dateien entfernen würde, bricht ab und sagt es.',
  'jobs.check': 'Auftrag prüfen',
  'check.healthy': 'Nichts zu melden. Beide Seiten sind erreichbar, und der gespeicherte Zustand stimmt mit dem überein, was tatsächlich da ist.',
  'check.more': 'Insgesamt {found} Funde, angezeigt werden die ersten {shown}.',
  'jobs.schedule.onRequest': 'auf Zuruf',
  'jobs.ago': 'her',

  'time.second': 'Sekunden',
  'time.minute': 'Minuten',
  'time.hour': 'Stunden',
  'time.day': 'Tage',
  'preview.title': 'Vorschau',
  'preview.for': 'Vorschau: {job}',
  'preview.working': 'Es wird ermittelt, was passieren würde. Nichts wurde angefasst.',
  'preview.nothing': 'Beide Seiten sind sich bereits einig. Es gibt nichts zu tun.',
  'preview.run': '{chosen} von {total} ausführen',
  'preview.starting': 'Startet',
  'preview.unchanged': 'Unverändert: {count}',
  'preview.identical': 'Auf beiden Seiten bereits gleich: {count}',
  'preview.skipped': 'Für später zurückgestellt',
  'preview.explain':
    'Bis zum Knopfdruck bewegt sich nichts. Schalte eine Zeile ab, dann bleibt sie genau so, wie sie ist.',

  'kind.copy': 'kopieren',
  'kind.move': 'verschieben',
  'kind.delete': 'löschen',
  'kind.conflict': 'Konflikt',
  'kind.mkdir': 'neuer Ordner',
  'kind.rmdir': 'Ordner entfernen',

  'direction.label': 'Richtung',
  'direction.both': 'Beide Wege',
  'direction.toRight': 'Nur nach rechts',
  'direction.toLeft': 'Nur nach links',
  'direction.hint':
    'Verglichen werden immer beide Seiten, denn nur so findet sich eine Änderung. Die Richtung entscheidet, was damit geschehen darf: einseitig wird eine Seite zur Quelle, wird nie beschrieben, und ihre Fassung ersetzt alles, was die andere Seite geändert hat. Eine Datei, die die Quelle nie hatte, bleibt liegen, das hier kopiert also, es spiegelt nicht.',
  'side.left': 'links',
  'side.right': 'rechts',

  'conflict.title': 'Beide Seiten haben diese Datei geändert',
  'conflict.keepBoth': 'Beide behalten',
  'conflict.keepLeft': 'Links behalten',
  'conflict.keepRight': 'Rechts behalten',
  'conflict.keepBothHint':
    'Die neuere Fassung behält auf beiden Seiten den schlichten Namen, die ältere bleibt daneben erhalten. Es geht nichts verloren.',
  'conflict.chosenHint':
    'Die Fassung, die du nicht gewählt hast, wandert auf ihrer Seite in den Papierkorb und bleibt dort erreichbar.',
  'conflict.newer': 'neuer',
  'conflict.size': 'Größe',
  'conflict.changed': 'Geändert',
  'conflict.missing': 'nicht vorhanden',

  'history.title': 'Verlauf',
  'history.empty': 'Es ist noch nichts gelaufen.',
  'history.loading': 'Lese, was dieser Lauf gemacht hat…',
  'history.nothing': 'Dieser Lauf hatte nichts zu tun.',
  'history.conflictHint': 'Ein geplanter Lauf behält beide Fassungen, weil er niemanden fragen kann. Wählst du hier, läuft ein neuer Lauf nur über diese Pfade; was der Lauf darüber getan hat, bleibt so im Protokoll stehen.',
  'history.applyChoices': 'Auswahl anwenden',
  'entry.copy': 'kopiert',
  'entry.move': 'verschoben',
  'entry.trash': 'in den Papierkorb',
  'trash.side': 'Welche Seite',
  'trash.empty': 'Auf dieser Seite liegt nichts im Papierkorb.',
  'trash.restore': 'Diese Datei zurücklegen',
  'trash.restored': '{path} liegt wieder da, wo es war.',
  'trash.unknownAge': 'Alter unbekannt',
  'trash.more': '{total} im Papierkorb, angezeigt werden {shown}.',
  'trash.days': 'Älter als, in Tagen',
  'trash.prune': 'Die alten rauswerfen',
  'trash.pruneConfirm': 'Alles im Papierkorb, was älter als {days} Tage ist, endgültig entfernen? Das ist das Einzige hier, was du nicht rückgängig machen kannst, denn geleert wird der Papierkorb selbst.',
  'trash.pruned': '{entries} aus dem Papierkorb entfernt.',
  'entry.conflict': 'Konflikt',
  'entry.mkdir': 'Ordner angelegt',
  'entry.rmdir': 'Ordner entfernt',
  'entry.skip': 'liegen gelassen',
  'entry.other': 'erledigt',
  'history.ok': 'in Ordnung',
  'history.failed': 'fehlgeschlagen',
  'history.copied': 'kopiert: {count}',
  'history.moved': 'verschoben: {count}',
  'history.trashed': 'in den Papierkorb: {count}',
  'history.conflicts': 'Konflikte: {count}',
  'history.left': 'zurückgestellt: {count}',

  'edit.add': 'Auftrag anlegen',
  'edit.remove': 'Entfernen',
  'edit.save': 'Speichern',
  'edit.name': 'Name',
  'edit.left': 'Linke Seite',
  'edit.right': 'Rechte Seite',
  'edit.state': 'Zustandsdatei',
  'edit.schedule': 'Zeitplan',
  'edit.exclude': 'Ausschlüsse',
  'sets.none': 'Noch keine gemeinsamen Listen.',
  'sets.noneYet': 'Es sind noch keine gemeinsamen Listen festgelegt. Angelegt werden sie in den Einstellungen unter Motor.',
  'sets.add': 'Diese Liste hinzufügen',
  'sets.remove': 'Diese Liste entfernen',
  'sets.newName': 'Name für eine neue Liste',
  'edit.emptyDirs': 'Leere Ordner mitnehmen',
  'edit.metadata': 'Rechte und Eigentümer mitnehmen',
  'edit.quietPeriod': 'Ruhezeit',
  'edit.quietUnit': 'Einheit',
  'edit.quiet.s': 'Sekunden',
  'edit.quiet.m': 'Minuten',
  'edit.quiet.h': 'Stunden',
  'edit.nameHint': 'Unter diesem Namen steht der Auftrag in der Liste, im Protokoll und in den Meldungen.',
  'edit.sideHint':
    'Ein Ordner, ein eingerichtetes Ziel als Name:Pfad, oder ein unter Ziele angemeldeter Datenträger.',
  'edit.stateHint':
    'Hier merkt sich der Auftrag, worauf sich beide Seiten zuletzt geeinigt haben. Eine Datei je Auftrag. Sie zu verlieren zerstört nichts, wirft den Auftrag aber zurück.',
  'edit.scheduleHint': 'Wann dieser Auftrag von selbst läuft. Manuell heißt: nur, wenn du ihn auf der Karte startest. Echtzeit reagiert innerhalb von Sekunden auf eine Änderung. Alle N, täglich und wöchentlich halten sich an die Uhr. Ausdruck ist für einen Rhythmus, den die Auswahl nicht sagen kann: als Cron geschrieben und in der Zeitzone dieses Rechners gelesen.',
  'edit.excludeHint':
    'Ein Muster je Zeile. Namen halbfertig geschriebener Dateien werden immer ausgeschlossen, unabhängig davon, was hier steht.',
  'edit.firstRun': 'Der erste Lauf',
  'edit.firstRunHint': 'Der erste Lauf entscheidet alles, und bisher war er der einzige, bei dem niemand gefragt wurde. Solange es noch keinen gespeicherten Zustand gibt, gilt jede Datei auf beiden Seiten als neu, also kommt alles von der linken Seite auf die rechte und ebenso umgekehrt. Wählst du stattdessen eine Seite, gewinnt diese Seite jede Uneinigkeit, und eine Datei, die sie nie hatte, bleibt genau dort liegen, wo sie ist: das erste Befüllen kopiert, es spiegelt nicht. Das gilt nur ein einziges Mal. Sobald ein Zustand vorliegt, wird die Einstellung nicht mehr beachtet.',
  'edit.firstRun.merge': 'Beide Seiten zusammenführen',
  'edit.firstRun.left': 'Die linke Seite hat recht',
  'edit.firstRun.right': 'Die rechte Seite hat recht',
  'edit.excludeSets': 'Gemeinsame Listen',
  'edit.excludeSetsHint': 'Listen, die du einmal in den Einstellungen festlegst. Was du hier auswählst, kommt zu den eigenen Mustern dieses Auftrags weiter unten dazu und ersetzt sie nicht.',
  'edit.quietHint': 'Wie lange eine einzelne Datei unverändert liegen muss, bevor ein Lauf sie anfasst. Das verhindert, dass eine halb geschriebene Datei mitten im Schreiben kopiert wird. Vorgabe sind fünf Sekunden, leer heißt sofort. Nicht zu verwechseln mit der Beruhigungszeit bei Echtzeit: die zählt für den ganzen Ordner.',
  'edit.runAtStart': 'Beim Programmstart sofort abgleichen',
  'edit.runAtStartHint':
    'Führt diesen Auftrag bei jedem Start einmal aus, bevor sein Zeitplan das nächste Mal dran ist. Ein Rechner, der über Nacht aus war, hat seinen Termin verpasst, und ohne das bleiben die beiden Seiten bis morgen auseinander.',
  'edit.emptyDirsHint':
    'Ein Ordner mit Dateien darin wandert ohnehin mit. Ein leerer hat nichts, was ihn andeutet, und braucht daher einen eigenen Vermerk. Bei einem Eimer aus, der kennt keine echten Ordner.',
  'edit.metadataHint':
    'Rechte, Eigentümer und erweiterte Attribute wandern mit den Daten mit, wo beide Seiten sie speichern können.',
  'edit.unnamed': 'ohne Namen',
  'edit.savedNote': 'Gespeichert. Zeitpläne und Beobachter wurden neu aufgebaut.',
  'edit.checking': 'Prüft',
  'edit.unsaved': 'noch nicht gespeichert',
  'edit.newJob': 'neuer-auftrag',
  'edit.pickDrive': 'Ein angemeldeter Datenträger',
  'edit.pickRemote': 'Ein eingerichtetes Ziel',
  'targets.storage': 'Speicher',
  'targets.storageEmpty':
    'Noch kein Speicherziel. Lege eines an, um einen S3-Eimer, einen SSH-Rechner oder eine Windows-Freigabe zu erreichen.',
  'targets.addStorage': 'Speicher anlegen',
  'targets.remoteName': 'Name',
  'targets.remoteNameHint':
    'Unter diesem Namen sprichst du das Ziel in einem Auftrag an, geschrieben als Name:Pfad. Keine Leerzeichen, keine Doppelpunkte.',
  'targets.kind': 'Art',
  'targets.check': 'Prüfen',
  'targets.checking': 'Prüft',
  'targets.checkOk': 'Erreicht',
  'targets.checkFailed': 'Nicht erreichbar',
  'targets.checkHint':
    'Ein gespeichertes Kennwort beweist nichts. Hier wird das Ziel geöffnet und aufgelistet, und nur das zeigt, ob die Angaben stimmen.',
  'targets.delete': 'Löschen',
  'targets.edit': 'Bearbeiten',
  'targets.cancel': 'Abbrechen',
  'targets.save': 'Speichern',
  'targets.secretSet': 'Ein Wert ist hinterlegt. Lass ihn stehen, dann bleibt er erhalten.',
  'targets.advanced': 'Alle Einstellungen zeigen',
  'targets.required': 'erforderlich',
  'confirm.deleteRemote': 'Dieses Speicherziel löschen',
  'confirm.deleteRemoteStakes':
    'Die Einstellungen für {name} werden aus rclones Konfiguration entfernt, samt jedem Kennwort und jedem Schlüssel, der dort liegt. Vorher wird nichts irgendwohin kopiert, und es gibt kein Zurück: neu einrichten heißt, die Zugangsdaten neu zu tippen. Aufträge, die darauf zeigen, scheitern beim nächsten Lauf, bis sie woandershin zeigen.',
  'confirm.delete': 'Löschen',
  'confirm.cancel': 'Abbrechen',
  'about.title': 'Über ArrowLoop',
  'about.body':
    'Ein einzelner Ritter, ein Feldzug: freie, quelloffene Werkzeuge, die es so nicht gab. Keine Konten, keine Telemetrie, und nichts Lesbares verlässt deine eigenen Mauern. An Abenden und Wochenenden mit viel Herzblut geschmiedet, weil Warten keine Option war.',
  'about.coffee':
    'ArrowLoop ist kostenlos und bleibt es. Eine Spende hält das Projekt am Leben und deckt, was es kostet: Domain, Server und die Abende, an denen weitergebaut wird.',
  'about.coffeeButton': 'Kaffee spendieren',
  'about.report': 'Probleme, Wünsche oder Verbesserungsvorschläge? Schreib es auf GitHub als Issue, oder schick eine E-Mail.',
  'about.version': 'Version',
  'about.unreleased': '{version}, kein veröffentlichter Stand',
  'about.repo': 'GitHub',
  'about.mail': 'E-Mail schreiben',
  'about.mailSubject': 'Rückmeldung',
  'secret.show': 'Zeigen',
  'secret.hide': 'Verbergen',

  'targets.drives': 'Datenträger',
  'targets.drivesEmpty':
    'Es ist kein Datenträger angemeldet. Melde einen an, damit ein Auftrag ihn wiederfindet, auch wenn er unter einem anderen Buchstaben zurückkommt.',
  'targets.driveExplain':
    'Ein Laufwerksbuchstabe ist keine Kennung: Die Platte von letzter Woche kann heute einen anderen tragen, und der alte Buchstabe gehört dann womöglich etwas ganz anderem. Beim Anmelden wird eine kleine Markierung auf den Datenträger selbst geschrieben, damit ein Auftrag der Platte folgt und nicht dem Buchstaben. Für eine Netzwerkfreigabe gilt dasselbe.',
  'targets.registerDrive': 'Datenträger anmelden',
  'targets.driveLabel': 'Name',
  'targets.driveLabelHint':
    'Wie du diese Platte nennst. Genau das siehst du, wenn sie nicht angeschlossen ist.',
  'targets.driveMount': 'Wo er gerade liegt',
  'targets.attached': 'angeschlossen',
  'targets.absent': 'nicht angeschlossen',
  'targets.forget': 'Vergessen',
  'targets.forgetHint':
    'Entfernt den Vermerk, dass dieser Datenträger je hier war. Die Markierung auf dem Datenträger bleibt, ein erneutes Anstecken bringt ihn also sofort zurück.',
  'targets.lastSeen': 'Zuletzt gesehen',
  'targets.noCandidates':
    'Nichts zum Anmelden. Steck einen Datenträger an oder binde eine Freigabe ein, dann schau noch einmal.',
  'targets.copyPath': 'Auftragspfad kopieren',
  'targets.copied': 'Kopiert',

  'look.theme': 'Farbmodus',
  'look.dark': 'Dunkel',
  'look.light': 'Hell',
  'look.corners': 'Ecken',
  'look.cornersHint':
    'Wie rund jede Ecke der App ist. Karten, Knoepfe, Felder und Schalter folgen alle dieser einen Einstellung.',
  'look.round': 'Rund',
  'look.soft': 'Weich',
  'look.square': 'Eckig',
  'look.colors': 'Farben',
  'look.accent': 'Akzentfarbe',
  'look.rainbowOn': 'Regenbogen-Modus',
  'look.rainbowReactive': 'Reaktiver Modus',
  'look.rainbowRotate': 'Farbenrotation',
  'look.rainbowHint':
    'Gibt jeder Karte eine eigene Farbe aus einer Palette, statt überall denselben Akzent zu setzen.',
  'look.reactiveHint': 'Baut die Palette um den gewählten Akzent herum statt um eine feste Farbe.',
  'look.rotateHint': 'Rückt die Palette bei jedem Besuch um eins weiter.',
  'look.palette': 'Farbpalette',
  'look.paletteHint': 'Jede Farbe lässt sich ändern. Ein Klick öffnet den Wähler darauf.',
  'look.motion': 'Bewegung',
  'look.motionHint': 'Wie stark sich die Oberfläche bewegt. Was dein System verlangt, wird nie überschrieben, sondern nur von dort nach unten geregelt.',
  'look.motionOff': 'Aus',
  'look.motionSubtle': 'Dezent',
  'look.motionFull': 'Voll',
  'look.labels': 'Beschriftungen',
  'look.labelsHint': 'Ob Bedienelemente ihre Worte zeigen, ihr Zeichen oder beides. Die Breite bleibt gleich, ein Wechsel verschiebt also nichts.',
  'look.labelsButtons': 'Buttons',
  'look.labelsSidebar': 'Seitenleiste',
  'look.labelsTabs': 'Tabs',
  'look.labelText': 'Text',
  'look.labelTextGlyph': 'Text und Symbol',
  'look.labelGlyph': 'Symbol',
  'look.labelReactive': 'Reaktiv',
  'look.language': 'Sprache',


  'reason.newOnSide': 'neu {side}',
  'reason.changedOnSide': 'geändert {side}',
  'reason.changedBothSame': 'auf beiden Seiten zum selben Inhalt geändert',
  'reason.changedBoth': 'auf beiden Seiten geändert',
  'reason.deletedOnSide': 'gelöscht {side}',
  'reason.restoredOnSide': 'nach dem Löschen {other} {side} bearbeitet und dadurch wiederhergestellt',
  'reason.renamedOnSide': 'umbenannt {side}',
  'reason.collision': 'Die Seite {side} enthält {names}, was die andere Seite womöglich nicht auseinanderhalten kann. Benenne eines davon um.',
  'reason.settling': 'vor weniger als {period} {side} geändert, wartet auf Ruhe',
  'reason.goneBoth': 'auf beiden Seiten verschwunden, der Vermerk entfällt',
  'reason.appearedSame': 'auf beiden Seiten mit gleichem Inhalt aufgetaucht',
  'reason.appearedDiffer': 'auf beiden Seiten mit verschiedenem Inhalt aufgetaucht',
  'reason.dirBoth': 'auf beiden Seiten',
  'reason.dirNewOnSide': 'neuer Ordner {side}',
  'reason.dirRemovedOnSide': 'Ordner entfernt {side}',
  'reason.dirGoneBoth': 'Ordner auf beiden Seiten verschwunden, der Vermerk entfällt',
  'reason.stepFailed': '{what} fehlgeschlagen, bleibt für den nächsten Lauf liegen: {error}',
  'reason.removeDirFailed': 'Der Ordner ließ sich nicht entfernen und bleibt stehen: {error}',
  'reason.heldOpen': 'wird {side} von einem anderen Programm offen gehalten, wartet auf das Schließen',
  'reason.unsupported': '{kind} {side}, was dieser Dienst nicht mitnimmt',
  'reason.recordFailed': 'Der Vermerk ließ sich nicht schreiben, bleibt für den nächsten Lauf liegen: {error}',

  'window.title': 'Fenster',
  'window.tray': 'Symbol im Infobereich',
  'window.trayHint':
    'Hält ArrowLoop erreichbar, während das Fenster weg ist. Ohne das Symbol hätten die beiden Einstellungen darunter kein Ziel, deshalb gehen sie mit aus.',
  'window.close': 'Der Schließen-Knopf versteckt das Fenster',
  'window.closeHint':
    'Standardmäßig aus, denn ein Schließen-Knopf, der nicht schließt, ist eine Überraschung, und einer, der ein laufendes Programm versteckt, ist die Sorte, die man eine Woche später findet und sich fragt, warum ein Auftrag immer noch läuft.',
  'window.minimise': 'Minimieren geht in den Infobereich',
  'window.minimiseHint': 'Statt in die Taskleiste. Zurück kommt das Fenster so oder so über das Symbol.',

  'start.title': 'Programmstart',
  'start.withSystem': 'Mit dem System starten',
  'start.withSystemHint':
    'ArrowLoop startet bei der Anmeldung, damit ein geplanter Auftrag läuft, ohne dass jemand vorher das Fenster öffnet. Der Eintrag gilt nur für dich und braucht keine Administratorrechte.',

  'progress.of': '{done} von {total}',
  'progress.starting': 'Startet',
  'progress.rate': '{rate} Dateien/s',
  'progress.left': 'noch {time}',
  'jobs.previewHint': 'Ermittelt, was dieser Auftrag tun würde, ohne etwas zu ändern. Danach kannst du jede Änderung einzeln an- oder abwählen, bevor sie ausgeführt wird.',
  'preview.back': 'Zurück',
  'preview.backHint': 'Verlässt die Vorschau, ohne etwas auszuführen. Escape tut dasselbe.',
  'history.filterJob': 'Auftrag',
  'history.allJobs': 'Alle Aufträge',
  'history.filterShow': 'Anzeigen',
  'history.showAll': 'Alle Läufe',
  'history.showChanged': 'Nur Läufe, die etwas getan haben',
  'history.showFailed': 'Nur Fehlschläge',
  'history.filterHint': 'Ein Auftrag, der einen Ordner beobachtet, schreibt bei jeder Änderung einen Eintrag. Einer, der jede Minute läuft, verdrängt damit einen, der einmal am Tag läuft, vollständig von der Seite. Diese Auswahl fragt den Motor nach anderen Läufen, statt einen Teil der schon geholten auszublenden. Deshalb kommt der gesuchte Auftrag auch dann zurück, wenn sein letzter Lauf tausend Einträge her ist. Ein fehlgeschlagener Lauf zählt immer als einer, der etwas getan hat.',
  'history.working': 'Wird gesucht.',
  'history.noMatch': 'Dazu passt kein Lauf.',
  'edit.trash': 'Auf jeder Seite einen Papierkorb führen',
  'edit.trashHint': 'Eine Löschung wird zu einem Verschieben in einen versteckten Ordner namens .arrowloop innerhalb des abgeglichenen Baums. Dadurch vernichtet dieser Auftrag nichts endgültig, und eine versehentlich gelöschte Datei holst du im Papierkorb-Reiter zurück. Dieser Ordner ist für alle sichtbar, die die Freigabe nutzen, und genau das ist der Grund, das hier auszuschalten: ohne Papierkorb entsteht er nie, eine Löschung ist endgültig, und die unterlegene Seite eines Konflikts ebenso. Für einen Download-Ordner vernünftig, für einen Dokumentenordner keine gute Idee.',
  'jobs.activityLoading': 'Es wird gelesen, was dieser Auftrag getan hat.',
  'history.more': 'Mehr anzeigen',
  'trash.holding': '{count} im Papierkorb, {size}',
}

// ---------------------------------------------------------------------------
// The languages on offer
// ---------------------------------------------------------------------------

export interface Language {
  /** BCP-47 code, and the name of the chunk under ./locales. */
  code: string
  /** The language's own name for itself, which is what belongs in a picker. */
  label: string
  /** ISO 3166-1 alpha-2 region code, for the flag. */
  flag: string
  /** Right to left, for Arabic, Hebrew and Persian. */
  rtl?: boolean
}

export const LANGUAGES: Language[] = [
  { code: 'en', label: 'English', flag: 'gb' },
  { code: 'de', label: 'Deutsch', flag: 'de' },
  { code: 'fr', label: 'Français', flag: 'fr' },
  { code: 'es', label: 'Español', flag: 'es' },
  { code: 'it', label: 'Italiano', flag: 'it' },
  { code: 'pt', label: 'Português', flag: 'pt' },
  { code: 'nl', label: 'Nederlands', flag: 'nl' },
  { code: 'pl', label: 'Polski', flag: 'pl' },
  { code: 'ru', label: 'Русский', flag: 'ru' },
  { code: 'uk', label: 'Українська', flag: 'ua' },
  { code: 'cs', label: 'Čeština', flag: 'cz' },
  { code: 'sv', label: 'Svenska', flag: 'se' },
  { code: 'da', label: 'Dansk', flag: 'dk' },
  { code: 'fi', label: 'Suomi', flag: 'fi' },
  { code: 'no', label: 'Norsk', flag: 'no' },
  { code: 'tr', label: 'Türkçe', flag: 'tr' },
  { code: 'el', label: 'Ελληνικά', flag: 'gr' },
  { code: 'hu', label: 'Magyar', flag: 'hu' },
  { code: 'ro', label: 'Română', flag: 'ro' },
  { code: 'ja', label: '日本語', flag: 'jp' },
  { code: 'ko', label: '한국어', flag: 'kr' },
  { code: 'zh', label: '中文', flag: 'cn' },
  { code: 'ar', label: 'العربية', flag: 'sa', rtl: true },
  { code: 'he', label: 'עברית', flag: 'il', rtl: true },
  { code: 'th', label: 'ไทย', flag: 'th' },
  { code: 'vi', label: 'Tiếng Việt', flag: 'vn' },
  { code: 'bg', label: 'Български', flag: 'bg' },
  { code: 'sk', label: 'Slovenčina', flag: 'sk' },
  { code: 'sl', label: 'Slovenščina', flag: 'si' },
  { code: 'hr', label: 'Hrvatski', flag: 'hr' },
  { code: 'sr', label: 'Српски', flag: 'rs' },
  { code: 'lt', label: 'Lietuvių', flag: 'lt' },
  { code: 'lv', label: 'Latviešu', flag: 'lv' },
  { code: 'et', label: 'Eesti', flag: 'ee' },
  { code: 'is', label: 'Íslenska', flag: 'is' },
  // The three languages of Spain get their own regional flags rather than three
  // identical Spanish ones, which would make the list unreadable at a glance.
  { code: 'ca', label: 'Català', flag: 'es-ct' },
  { code: 'gl', label: 'Galego', flag: 'es-ga' },
  { code: 'eu', label: 'Euskara', flag: 'es-pv' },
  { code: 'id', label: 'Bahasa Indonesia', flag: 'id' },
  { code: 'ms', label: 'Bahasa Melayu', flag: 'my' },
  { code: 'hi', label: 'हिन्दी', flag: 'in' },
  { code: 'fa', label: 'فارسی', flag: 'ir', rtl: true },
]

export const SUPPORTED = LANGUAGES.map((l) => l.code)

export const isRtl = (code: string): boolean => LANGUAGES.find((l) => l.code === code)?.rtl ?? false

const DEFAULT_CODE = 'en'
const STORAGE_KEY = 'arrowloop.lang'

/**
 * The language in use, resolved from the browser when nobody has chosen one.
 *
 * There is deliberately no "automatic" entry in the picker. That entry looks
 * like an option and is an excuse: it fails to answer the only question
 * somebody opens the list to ask, which is which language is running right now.
 * The browser's preference is resolved here and the real language it lands on
 * is what the list shows as selected.
 */
function resolveCode(raw: string | null): string {
  if (raw && SUPPORTED.includes(raw)) return raw
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const short = candidate.slice(0, 2).toLowerCase()
    if (SUPPORTED.includes(short)) return short
  }
  return DEFAULT_CODE
}

function storedCode(): string {
  try {
    return resolveCode(localStorage.getItem(STORAGE_KEY))
  } catch {
    return resolveCode(null)
  }
}

/** Set the document language before the first render, so a right-to-left page
 *  does not arrive the wrong way round and swap. */
export function applyStoredLanguage(): void {
  const code = storedCode()
  document.documentElement.setAttribute('lang', code)
  document.documentElement.setAttribute('dir', isRtl(code) ? 'rtl' : 'ltr')
}

export const locales: Record<string, Partial<Translations>> = { en, de }

/**
 * The translate function, named so a plain function can take one.
 *
 * A helper that turns data into a sentence needs `t` and nothing else from the
 * context, and it should not have to be a component to say so.
 */
export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

export interface I18nContextValue {
  lang: string
  setLanguage: (code: string) => void
  t: Translate
  languages: Language[]
}

/** Filled in with the placeholder values a sentence needs. */
function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_CODE,
  setLanguage: () => undefined,
  t: (key, vars) => fill(en[key] ?? key, vars),
  languages: LANGUAGES,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<string>(storedCode)
  const [table, setTable] = useState<Partial<Translations>>(() => locales[storedCode()] ?? en)

  useEffect(() => {
    if (locales[lang]) {
      setTable(locales[lang])
      return
    }
    let current = true
    // A flag rather than an abort: two quick switches race, and the LAST one
    // has to win whichever chunk happens to land first.
    void loadLocale(lang).then((next) => {
      if (current) setTable(next)
    })
    return () => {
      current = false
    }
  }, [lang])

  const setLanguage = useCallback((code: string) => {
    if (!SUPPORTED.includes(code)) return
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // A browser with storage turned off forgets the choice on reload, which
      // is worth strictly less than refusing to change language at all.
    }
    document.documentElement.setAttribute('lang', code)
    document.documentElement.setAttribute('dir', isRtl(code) ? 'rtl' : 'ltr')
    // Fetch before the state change, so switching shows the new language
    // rather than a beat of English on the way to it.
    void loadLocale(code).then(() => setLangState(code))
  }, [])

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      fill(table[key] ?? en[key] ?? key, vars),
    [table],
  )

  return createElement(I18nContext.Provider, { value: { lang, setLanguage, t, languages: LANGUAGES } }, children)
}

export function useT(): I18nContextValue {
  return useContext(I18nContext)
}

/** One reason from the engine: a code with its values, and the English sentence. */
export interface Reason {
  code: string
  vars?: Record<string, string>
  text: string
}

/**
 * Render a reason in the reader's language.
 *
 * The engine sends both halves on purpose. Translating on its side would mean
 * knowing the reader's language on every run, and would leave the log written
 * in whichever language somebody last asked a question in. So the code is
 * translated here, and a code this build has never heard of falls back to the
 * engine's own sentence rather than to the code itself: an explanation in the
 * wrong language is worth more than a dotted identifier.
 *
 * The values are translated too. A sentence that reads "geändert on the left"
 * is not translated, it is half translated, which is the more annoying half.
 */
export function useReason(): (reason?: Reason | null) => string {
  const { t } = useT()
  return (reason) => {
    if (!reason) return ''
    const key = `reason.${reason.code}` as TranslationKey
    const vars: Record<string, string> = {}
    for (const [name, value] of Object.entries(reason.vars ?? {})) {
      vars[name] = name === 'side' || name === 'other' ? translateSide(t, value) : value
    }
    // en carries every code this build knows. Anything else is a newer engine
    // talking to an older interface, and its own sentence is the better answer.
    if (!(key in en)) return reason.text
    return t(key, vars)
  }
}

/** A side named by the engine, in the reader's language. */
export function translateSide(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  side: string,
): string {
  if (side === 'left') return t('side.left')
  if (side === 'right') return t('side.right')
  return side
}
