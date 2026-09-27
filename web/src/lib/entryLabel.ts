import type { TranslationKey } from './i18n.data'

// Only the fields read here, and not the api module's types or React, so the
// phone app can share this file: its build installs neither the web's
// packages nor the web's Vite-only i18n loader.
export type Job = { name: string; left: string; right: string }
export type Drive = { id: string; label: string }
type Entry = { Kind: string; Side: string; Note?: string; Path?: string }

/**
 * What one side of a job is: a folder on this device, a registered drive, or
 * a target named before the colon, such as a cloud or a server. A folder is
 * named by its last segment, which is what tells two folders on one device
 * apart.
 */
export type Place = { kind: 'device' | 'drive' | 'target'; name: string }

const DRIVE = 'volume:'

// Two letters at least, so a Windows drive letter stays a local path.
const TARGET = /^([^:/\\]{2,}):/

export function placeOf(path: string, drives: Drive[]): Place {
  if (path.startsWith(DRIVE)) {
    const id = path.slice(DRIVE.length).split('/')[0] ?? ''
    return { kind: 'drive', name: drives.find((d) => d.id === id)?.label || id }
  }
  const target = TARGET.exec(path)
  if (target) return { kind: 'target', name: target[1]! }
  const trimmed = path.replace(/[\\/]+$/, '')
  return { kind: 'device', name: trimmed.split(/[\\/]/).pop() || trimmed }
}

/** The kinds in their plain words, for an entry whose sides are not known. */
const PLAIN: Record<string, TranslationKey> = {
  copy: 'entry.copy',
  move: 'entry.move',
  trash: 'entry.trash',
  // An older engine's word for a trash.
  delete: 'entry.trash',
  conflict: 'entry.conflict',
  mkdir: 'entry.mkdir',
  rmdir: 'entry.rmdir',
  skip: 'entry.skip',
  record: 'entry.record',
  unverified: 'entry.unverified',
  error: 'entry.failed',
}

/**
 * The words the engine writes as the note on ordinary work, which the label
 * already says (internal/apply's Note constants and plan.Resolution).
 */
const REPLACED = 'replaced'
const RELOCATED = 'relocated'
const BIN = 'bin'
const SAID = new Set([REPLACED, RELOCATED, BIN, 'keep both', 'keep left', 'keep right'])

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string

/** A kind in its plain word, or null for one this build does not know. */
export function plainKey(kind: string): TranslationKey | null {
  return PLAIN[kind] ?? null
}

/** The folder a path sits in, which a rename keeps and a move changes. */
function folderOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

/**
 * What happened to one file, said the way somebody checking on a sync asks:
 * uploaded to which cloud, deleted where. The side on an entry is the one
 * written to. A skip with a side is a step that failed there; one without is
 * a file that was postponed or left alone, and keeps its plain word.
 *
 * The note refines it where the engine wrote one: a copy over a file that was
 * there, a rename rather than a move, a file that left for the other side, a
 * deletion into the bin. An entry from before the engine wrote these keeps
 * the wording without them.
 */
export function entryLabel(t: T, e: Entry, job: Job | undefined, drives: Drive[]): string {
  const note = e.Note ?? ''
  const known = plainKey(e.Kind)
  const plain = known ? t(known) : e.Kind

  if (e.Kind === 'conflict') {
    if (note === 'keep left' || note === 'keep right') {
      if (!job) return plain
      const kept = placeOf(note === 'keep left' ? job.left : job.right, drives)
      return t('entry.conflictKept', { place: kept.name })
    }
    return t('entry.conflictBoth')
  }
  if (!job || (e.Side !== 'left' && e.Side !== 'right')) return plain
  const to = placeOf(e.Side === 'left' ? job.left : job.right, drives)
  const from = placeOf(e.Side === 'left' ? job.right : job.left, drives)
  // "Locally" only means something when the other side is somewhere else.
  const here = (local: TranslationKey, there: TranslationKey) =>
    to.kind === 'device' && from.kind !== 'device' ? t(local) : t(there, { place: to.name })

  switch (e.Kind) {
    case 'copy':
      if (note === REPLACED) return here('entry.replaceLocal', 'entry.replaceIn')
      if (to.kind === 'target' && from.kind !== 'target') return t('entry.upload', { place: to.name })
      if (from.kind === 'target' && to.kind !== 'target') return t('entry.download', { place: from.name })
      if (from.kind === 'drive' && to.kind === 'device') return t('entry.copyFrom', { place: from.name })
      return t('entry.copyTo', { place: to.name })
    case 'move':
      // The side is where the file left, and it went to the other one.
      if (note === RELOCATED) return t('entry.relocate', { place: from.name })
      if (note && e.Path !== undefined && folderOf(note) === folderOf(e.Path))
        return here('entry.renameLocal', 'entry.renameIn')
      return here('entry.moveLocal', 'entry.moveIn')
    case 'trash':
    case 'delete':
      if (note === BIN) return here('entry.binLocal', 'entry.binIn')
      return here('entry.trashLocal', 'entry.trashIn')
    case 'mkdir':
      return here('entry.mkdirLocal', 'entry.mkdirIn')
    case 'rmdir':
      return here('entry.rmdirLocal', 'entry.rmdirIn')
    case 'skip':
      if (to.kind === 'target' && from.kind !== 'target') return t('entry.uploadFailed')
      if (from.kind === 'target' && to.kind !== 'target') return t('entry.downloadFailed')
      return t('entry.failed')
    default:
      return plain
  }
}

/**
 * The note to show beside an entry, or null when the label has said it: an
 * error's words and a skip's reason as the engine wrote them, and the name a
 * renamed file had before.
 */
export function entryNote(t: T, e: Entry): string | null {
  const note = e.Note ?? ''
  if (!note || SAID.has(note)) return null
  if (e.Kind === 'move') return t('entry.was', { path: note })
  return note
}

/**
 * Where a change took a file from and to, as full paths on the job's sides:
 * a copy's source and destination, a rename's old and new name, both copies
 * of a conflict. A change in one place, such as a deletion, has no `from`.
 * Null without the job, which a removed job no longer has.
 */
export function entryRoute(
  e: Entry,
  job: Job | undefined,
  drives: Drive[],
): { from?: string; to: string; both?: boolean } | null {
  const path = e.Path ?? ''
  if (!job || !path) return null
  const at = (root: string, p: string) => within(root, p, drives)
  if (e.Kind === 'conflict') return { from: at(job.left, path), to: at(job.right, path), both: true }
  if (e.Side !== 'left' && e.Side !== 'right') return null
  const side = e.Side === 'left' ? job.left : job.right
  const other = e.Side === 'left' ? job.right : job.left
  const note = e.Note ?? ''
  if (e.Kind === 'copy') return { from: at(other, path), to: at(side, path) }
  if (e.Kind === 'move') {
    // The side of a relocation is where the file left, as in entryLabel.
    if (note === RELOCATED) return { from: at(side, path), to: at(other, path) }
    if (note && !SAID.has(note)) return { from: at(side, note), to: at(side, path) }
  }
  return { to: at(side, path) }
}

/**
 * A path inside one side, joined the way that side writes paths: backslashes
 * on a Windows folder, the target's own form after its colon, and a drive by
 * its label rather than its id.
 */
function within(root: string, path: string, drives: Drive[]): string {
  if (root.startsWith(DRIVE)) {
    const [id = '', ...rest] = root.slice(DRIVE.length).split('/')
    const label = drives.find((d) => d.id === id)?.label || id
    return [label, ...rest.filter(Boolean), path].join('/')
  }
  if (root.endsWith(':')) return root + path
  if (/^[A-Za-z]:\\/.test(root) || (root.includes('\\') && !root.includes('/'))) {
    return `${root.replace(/\\+$/, '')}\\${path.replaceAll('/', '\\')}`
  }
  return `${root.replace(/\/+$/, '')}/${path}`
}
