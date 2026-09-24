import { createContext, useContext } from 'react'

import type { TranslationKey } from './i18n.data'

// Only the fields read here, and not the api module's types, so the phone app
// can share this file without the web's Vite-only i18n loader.
type Job = { name: string; left: string; right: string }
type Drive = { id: string; label: string }
type Entry = { Kind: string; Side: string }

/**
 * What one side of a job is: this device, a registered drive, or a target
 * named before the colon, such as a cloud or a server.
 */
export type Place = { kind: 'device' } | { kind: 'drive' | 'target'; name: string }

/** The jobs and drives the log needs to name a side, provided once by App. */
export const Places = createContext<{ jobs: Job[]; drives: Drive[] }>({ jobs: [], drives: [] })

export function usePlaces() {
  return useContext(Places)
}

const DRIVE = 'volume:'

// Two letters at least, so a Windows drive letter stays a local path.
const TARGET = /^([^:/\\]{2,}):/

export function placeOf(path: string, drives: Drive[]): Place {
  if (path.startsWith(DRIVE)) {
    const id = path.slice(DRIVE.length).split('/')[0] ?? ''
    return { kind: 'drive', name: drives.find((d) => d.id === id)?.label || id }
  }
  const target = TARGET.exec(path)
  return target ? { kind: 'target', name: target[1]! } : { kind: 'device' }
}

/** The kinds in their plain words, for an entry whose sides are not known. */
const PLAIN: Record<string, TranslationKey> = {
  copy: 'entry.copy',
  move: 'entry.move',
  trash: 'entry.trash',
  conflict: 'entry.conflict',
  mkdir: 'entry.mkdir',
  rmdir: 'entry.rmdir',
  skip: 'entry.skip',
}

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string

/**
 * What happened to one file, said the way somebody checking on a sync asks:
 * uploaded to which cloud, deleted where. The side on an entry is the one
 * written to. A skip with a side is a step that failed there; one without is
 * a file that was postponed or left alone, and keeps its plain word.
 */
export function entryLabel(t: T, e: Entry, job: Job | undefined, drives: Drive[]): string {
  const plain = t(PLAIN[e.Kind] ?? 'entry.other')
  if (!job || (e.Side !== 'left' && e.Side !== 'right')) return plain
  const to = placeOf(e.Side === 'left' ? job.left : job.right, drives)
  const from = placeOf(e.Side === 'left' ? job.right : job.left, drives)
  const here = (local: TranslationKey, there: TranslationKey) =>
    to.kind === 'device' ? t(local) : t(there, { place: to.name })

  switch (e.Kind) {
    case 'copy':
      if (to.kind === 'target' && from.kind !== 'target') return t('entry.upload', { place: to.name })
      if (from.kind === 'target' && to.kind !== 'target') return t('entry.download', { place: from.name })
      if (to.kind !== 'device') return t('entry.copyTo', { place: to.name })
      if (from.kind !== 'device') return t('entry.copyFrom', { place: from.name })
      return plain
    case 'move':
      return here('entry.moveLocal', 'entry.moveIn')
    case 'trash':
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
