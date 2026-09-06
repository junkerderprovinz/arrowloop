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

import { flagEmoji } from './flagEmoji'

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
  'app.tagline': 'Two-way file sync',
  'nav.jobs': 'Jobs',
  'nav.edit': 'Edit',
  'nav.targets': 'Targets',
  'nav.history': 'History',
  'nav.look': 'Look',
  'nav.section': 'Section',

  'error.unreachable': 'Cannot reach the engine',

  // Jobs
  'jobs.title': 'Jobs',
  'jobs.empty': 'No jobs are configured yet. Add one on the Edit tab.',
  'jobs.preview': 'Preview',
  'jobs.state.running': 'running',
  'jobs.state.disabled': 'disabled',
  'jobs.state.waiting': 'waiting',
  'jobs.state.settled': 'settled',
  'jobs.state.detached': 'not attached',
  'jobs.schedule.onRequest': 'on request',
  'jobs.neverWorked': 'never worked',
  'jobs.ago': 'ago',

  // Units of elapsed time, written out because an abbreviation that reads
  // naturally in English rarely does anywhere else.
  'time.second': 'seconds',
  'time.minute': 'minutes',
  'time.hour': 'hours',
  'time.day': 'days',
  'time.year': 'years',

  // Preview
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
  'history.ok': 'ok',
  'history.failed': 'failed',
  'history.copied': 'copied: {count}',
  'history.moved': 'moved: {count}',
  'history.trashed': 'trashed: {count}',
  'history.conflicts': 'conflicts: {count}',
  'history.left': 'left for later: {count}',

  // Editor
  'edit.title': 'Jobs',
  'edit.add': 'Add a job',
  'edit.remove': 'Remove',
  'edit.save': 'Save',
  'edit.saving': 'Saving',
  'edit.saved': 'Saved',
  'edit.name': 'Name',
  'edit.left': 'Left side',
  'edit.right': 'Right side',
  'edit.state': 'State file',
  'edit.schedule': 'Schedule',
  'edit.exclude': 'Exclude',
  'edit.disabled': 'Disabled',
  'edit.watch': 'Watch for changes',
  'edit.emptyDirs': 'Carry empty folders',
  'edit.metadata': 'Carry permissions and ownership',
  'edit.quietPeriod': 'Quiet period',
  'edit.nameHint': 'How this job is named in the list, the log and the notifications.',
  'edit.sideHint':
    'A folder, a configured target as name:path, or a drive registered on the Targets tab.',
  'edit.stateHint':
    'Where this job remembers what the two sides last agreed on. One file per job, and losing it is not destructive but it is disruptive.',
  'edit.scheduleHint': 'A cron expression, read in this machine timezone. Empty means on request only.',
  'edit.excludeHint':
    'One pattern per line. Names of half-written files are always excluded, whatever is here.',
  'edit.quietHint':
    'A file changed more recently than this is left for the next run, because it is probably still being written.',
  'edit.watchHint':
    'React to changes as they happen rather than only on the schedule. Only a local side can be watched.',
  'edit.pick': 'Pick',
  'edit.disabledHint':
    'Keeps the job in the file without running it. A job you are still setting up belongs here until you have read its preview once.',
  'edit.emptyDirsHint':
    'A folder with files in it travels anyway. An empty one has nothing to imply it, so it needs a record of its own. Off for a bucket, which has no real folders.',
  'edit.metadataHint':
    'Permissions, ownership and extended attributes travel with the bytes, wherever both sides can store them.',
  'edit.reading': 'Reading the configuration.',
  'edit.unnamed': 'unnamed',
  'edit.watching': 'watching',
  'edit.savedNote': 'Saved. The schedules and the watchers were rebuilt.',
  'edit.checking': 'Checking',
  'edit.noJobs': 'No jobs yet. Add one.',
  'edit.newJob': 'new-job',
  'edit.pickDrive': 'A registered drive',
  'edit.pickRemote': 'A configured target',
  'edit.pickNothing': 'Nothing registered yet',

  // Targets: remotes
  'targets.title': 'Targets',
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
  'confirm.cancel': 'Leave it',
  'about.title': 'About this app',
  'about.body':
    'Something wrong, or something missing? Say so. An issue on the repository is the best place, because the answer stays where the next person can find it, and an email is fine too.',
  'about.version': 'ArrowLoop',
  'about.glimstone': 'GlimStone',
  'about.unreleased': '{version}, not a released build',
  'about.repo': 'Open an issue',
  'about.mail': 'Send an email',
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
  'targets.registered': 'registered',
  'targets.noCandidates': 'Nothing to register. Plug a drive in or mount a share, then look again.',
  'targets.copyPath': 'Copy the job path',
  'targets.copied': 'Copied',

  // Look
  'look.theme': 'Theme',
  'look.dark': 'Dark',
  'look.light': 'Light',
  'look.corners': 'Corners',
  'look.round': 'Round',
  'look.soft': 'Soft',
  'look.square': 'Square',
  'look.accent': 'Accent',
  'look.rainbow': 'Rainbow',
  'look.rainbowOn': 'On',
  'look.rainbowReactive': 'Follows the accent',
  'look.rainbowRotate': 'Rotate',
  'look.rainbowHint':
    'Gives each card its own colour from one palette instead of one accent everywhere.',
  'look.reactiveHint': 'Builds the palette around the accent you picked, rather than a fixed one.',
  'look.rotateHint': 'Moves the palette along by one on every visit.',
  'look.palette': 'Palette',
  'look.paletteHint': 'Each colour can be changed. A click opens the picker on it.',
  'look.motion': 'Motion',
  'look.motionHint': 'How much the interface moves. It never overrides what your system asks for, it only dials down from there.',
  'look.motionOff': 'Off',
  'look.motionSubtle': 'Subtle',
  'look.motionFull': 'Full',
  'look.labels': 'Labels',
  'look.labelsHint': 'Whether controls show their words, their glyph, or both. The width does not change, so switching never moves the page.',
  'look.labelsButtons': 'Buttons',
  'look.labelsSidebar': 'Navigation rail',
  'look.labelsTabs': 'Tabs',
  'look.labelText': 'Words',
  'look.labelTextGlyph': 'Both',
  'look.labelGlyph': 'Glyph',
  'look.labelReactive': 'Words on hover',
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

  'progress.of': '{done} of {total}',
  'progress.starting': 'Starting',
  'progress.finishing': 'Finishing',
} as const

export type TranslationKey = keyof typeof en
export type Translations = Record<TranslationKey, string>

export const de: Translations = {
  'app.tagline': 'Dateiabgleich in beide Richtungen',
  'nav.jobs': 'Aufträge',
  'nav.edit': 'Bearbeiten',
  'nav.targets': 'Ziele',
  'nav.history': 'Verlauf',
  'nav.look': 'Aussehen',
  'nav.section': 'Bereich',

  'error.unreachable': 'Der Dienst ist nicht erreichbar',

  'jobs.title': 'Aufträge',
  'jobs.empty': 'Es ist noch kein Auftrag eingerichtet. Lege einen unter Bearbeiten an.',
  'jobs.preview': 'Vorschau',
  'jobs.state.running': 'läuft',
  'jobs.state.disabled': 'abgeschaltet',
  'jobs.state.waiting': 'wartet',
  'jobs.state.settled': 'abgeglichen',
  'jobs.state.detached': 'nicht angeschlossen',
  'jobs.schedule.onRequest': 'auf Zuruf',
  'jobs.neverWorked': 'noch nie gelaufen',
  'jobs.ago': 'her',

  'time.second': 'Sekunden',
  'time.minute': 'Minuten',
  'time.hour': 'Stunden',
  'time.day': 'Tage',
  'time.year': 'Jahre',

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
  'history.ok': 'in Ordnung',
  'history.failed': 'fehlgeschlagen',
  'history.copied': 'kopiert: {count}',
  'history.moved': 'verschoben: {count}',
  'history.trashed': 'in den Papierkorb: {count}',
  'history.conflicts': 'Konflikte: {count}',
  'history.left': 'zurückgestellt: {count}',

  'edit.title': 'Aufträge',
  'edit.add': 'Auftrag anlegen',
  'edit.remove': 'Entfernen',
  'edit.save': 'Speichern',
  'edit.saving': 'Speichert',
  'edit.saved': 'Gespeichert',
  'edit.name': 'Name',
  'edit.left': 'Linke Seite',
  'edit.right': 'Rechte Seite',
  'edit.state': 'Zustandsdatei',
  'edit.schedule': 'Zeitplan',
  'edit.exclude': 'Ausschließen',
  'edit.disabled': 'Abgeschaltet',
  'edit.watch': 'Auf Änderungen achten',
  'edit.emptyDirs': 'Leere Ordner mitnehmen',
  'edit.metadata': 'Rechte und Eigentümer mitnehmen',
  'edit.quietPeriod': 'Ruhezeit',
  'edit.nameHint': 'Unter diesem Namen steht der Auftrag in der Liste, im Protokoll und in den Meldungen.',
  'edit.sideHint':
    'Ein Ordner, ein eingerichtetes Ziel als Name:Pfad, oder ein unter Ziele angemeldeter Datenträger.',
  'edit.stateHint':
    'Hier merkt sich der Auftrag, worauf sich beide Seiten zuletzt geeinigt haben. Eine Datei je Auftrag. Sie zu verlieren zerstört nichts, wirft den Auftrag aber zurück.',
  'edit.scheduleHint':
    'Ein Cron-Ausdruck, gelesen in der Zeitzone dieses Rechners. Leer heißt: nur auf Zuruf.',
  'edit.excludeHint':
    'Ein Muster je Zeile. Namen halbfertig geschriebener Dateien werden immer ausgeschlossen, unabhängig davon, was hier steht.',
  'edit.quietHint':
    'Eine Datei, die kürzlich als hier angegeben geändert wurde, bleibt für den nächsten Lauf liegen, weil sie vermutlich noch geschrieben wird.',
  'edit.watchHint':
    'Auf Änderungen reagieren, sobald sie geschehen, statt nur nach Zeitplan. Beobachten lässt sich nur eine lokale Seite.',
  'edit.pick': 'Auswählen',
  'edit.disabledHint':
    'Behält den Auftrag in der Datei, ohne ihn laufen zu lassen. Ein Auftrag, den du noch einrichtest, gehört hierher, bis du seine Vorschau einmal gelesen hast.',
  'edit.emptyDirsHint':
    'Ein Ordner mit Dateien darin wandert ohnehin mit. Ein leerer hat nichts, was ihn andeutet, und braucht daher einen eigenen Vermerk. Bei einem Eimer aus, der kennt keine echten Ordner.',
  'edit.metadataHint':
    'Rechte, Eigentümer und erweiterte Attribute wandern mit den Daten mit, wo beide Seiten sie speichern können.',
  'edit.reading': 'Die Einrichtung wird gelesen.',
  'edit.unnamed': 'ohne Namen',
  'edit.watching': 'beobachtet',
  'edit.savedNote': 'Gespeichert. Zeitpläne und Beobachter wurden neu aufgebaut.',
  'edit.checking': 'Prüft',
  'edit.noJobs': 'Noch kein Auftrag. Lege einen an.',
  'edit.newJob': 'neuer-auftrag',
  'edit.pickDrive': 'Ein angemeldeter Datenträger',
  'edit.pickRemote': 'Ein eingerichtetes Ziel',
  'edit.pickNothing': 'Noch nichts angemeldet',

  'targets.title': 'Ziele',
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
    'Die Einstellungen für {name} werden aus rclones Konfiguration entfernt, samt allem Kennwort und Schlüssel, der dort liegt. Vorher wird nichts irgendwohin kopiert, und es gibt kein Zurück: neu einrichten heißt, die Zugangsdaten neu zu tippen. Aufträge, die darauf zeigen, scheitern beim nächsten Lauf, bis sie woandershin zeigen.',
  'confirm.delete': 'Löschen',
  'confirm.cancel': 'Stehen lassen',
  'about.title': 'Über diese App',
  'about.body':
    'Etwas falsch, oder etwas fehlt? Sag es. Ein Issue im Repository ist der beste Ort, weil die Antwort dort steht, wo der Nächste sie findet, und eine E-Mail geht auch.',
  'about.version': 'ArrowLoop',
  'about.glimstone': 'GlimStone',
  'about.unreleased': '{version}, kein veröffentlichter Stand',
  'about.repo': 'Issue anlegen',
  'about.mail': 'E-Mail schreiben',
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
  'targets.registered': 'angemeldet',
  'targets.noCandidates':
    'Nichts zum Anmelden. Steck einen Datenträger an oder binde eine Freigabe ein, dann schau noch einmal.',
  'targets.copyPath': 'Auftragspfad kopieren',
  'targets.copied': 'Kopiert',

  'look.theme': 'Farbmodus',
  'look.dark': 'Dunkel',
  'look.light': 'Hell',
  'look.corners': 'Ecken',
  'look.round': 'Rund',
  'look.soft': 'Weich',
  'look.square': 'Eckig',
  'look.accent': 'Akzent',
  'look.rainbow': 'Regenbogen',
  'look.rainbowOn': 'An',
  'look.rainbowReactive': 'Folgt dem Akzent',
  'look.rainbowRotate': 'Weiterdrehen',
  'look.rainbowHint':
    'Gibt jeder Karte eine eigene Farbe aus einer Palette, statt überall denselben Akzent zu setzen.',
  'look.reactiveHint': 'Baut die Palette um den gewählten Akzent herum statt um eine feste Farbe.',
  'look.rotateHint': 'Rückt die Palette bei jedem Besuch um eins weiter.',
  'look.palette': 'Palette',
  'look.paletteHint': 'Jede Farbe lässt sich ändern. Ein Klick öffnet den Wähler darauf.',
  'look.motion': 'Bewegung',
  'look.motionHint': 'Wie stark sich die Oberfläche bewegt. Was dein System verlangt, wird nie überschrieben, sondern nur von dort nach unten geregelt.',
  'look.motionOff': 'Aus',
  'look.motionSubtle': 'Dezent',
  'look.motionFull': 'Voll',
  'look.labels': 'Beschriftung',
  'look.labelsHint': 'Ob Bedienelemente ihre Worte zeigen, ihr Zeichen oder beides. Die Breite bleibt gleich, ein Wechsel verschiebt also nichts.',
  'look.labelsButtons': 'Knöpfe',
  'look.labelsSidebar': 'Navigationsleiste',
  'look.labelsTabs': 'Reiter',
  'look.labelText': 'Worte',
  'look.labelTextGlyph': 'Beides',
  'look.labelGlyph': 'Zeichen',
  'look.labelReactive': 'Worte beim Zeigen',
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

  'progress.of': '{done} von {total}',
  'progress.starting': 'Startet',
  'progress.finishing': 'Schließt ab',
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

/** The flag for a language, or nothing for the three regional ones, whose
 *  codes are not countries and have no emoji. */
export function languageFlag(code: string): string {
  const lang = LANGUAGES.find((l) => l.code === code)
  if (!lang || lang.flag.includes('-')) return ''
  return flagEmoji(lang.flag)
}

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

export interface I18nContextValue {
  lang: string
  setLanguage: (code: string) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
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
