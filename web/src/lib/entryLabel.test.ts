import { describe, expect, it } from 'vitest'

import type { Job, RunEntry, Volume } from './api'
import { de } from './i18n'
import { entryLabel, placeOf } from './entryLabel'

// The German table, so the test reads the phrases somebody asked for.
const t = (key: string, vars?: Record<string, string | number>) =>
  (de[key as keyof typeof de] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''))

const drives: Volume[] = [
  { id: 'a1b2', label: 'Backup-Platte', mount: 'E:\\', attached: true, lastSeen: null, path: 'E:\\' },
]

function job(left: string, right: string): Job {
  return {
    name: 'fotos',
    left,
    right,
    direction: 'both',
    schedule: '',
    watch: false,
    disabled: false,
    running: false,
    lastSuccess: null,
  }
}

const entry = (Kind: string, Side: string): RunEntry => ({ Kind, Side, Path: 'a.jpg', Note: '', Size: 0 })

describe('where a side is', () => {
  it('keeps a Windows drive letter on this device, named by its folder', () => {
    expect(placeOf('C:\\Users\\jdp\\Fotos', drives)).toEqual({ kind: 'device', name: 'Fotos' })
  })

  it('names a target by what comes before the colon', () => {
    expect(placeOf('OpenCloud-Test:Fotos', drives)).toEqual({ kind: 'target', name: 'OpenCloud-Test' })
  })

  it('names a registered drive by its label', () => {
    expect(placeOf('volume:a1b2/Fotos', drives)).toEqual({ kind: 'drive', name: 'Backup-Platte' })
  })
})

describe('what happened to a file', () => {
  const cloud = job('/data/fotos', 'OpenCloud-Test:Fotos')

  it.each([
    ['copy', 'right', 'Nach OpenCloud-Test hochgeladen'],
    ['copy', 'left', 'Von OpenCloud-Test heruntergeladen'],
    ['trash', 'left', 'Lokal gelöscht'],
    ['trash', 'right', 'In OpenCloud-Test gelöscht'],
    ['skip', 'right', 'Upload fehlgeschlagen'],
    ['skip', 'left', 'Download fehlgeschlagen'],
    ['mkdir', 'right', 'Ordner in OpenCloud-Test angelegt'],
  ])('%s on the %s side reads "%s"', (kind, side, want) => {
    expect(entryLabel(t, entry(kind, side), cloud, drives)).toBe(want)
  })

  it('copies between two drives by name', () => {
    expect(entryLabel(t, entry('copy', 'right'), job('/data', 'volume:a1b2/x'), drives)).toBe(
      'Nach Backup-Platte kopiert',
    )
  })

  it('names the folder when both sides are on this device', () => {
    const local = job('/mnt/user/testlinks', '/mnt/user/testrechts/')
    expect(entryLabel(t, entry('copy', 'right'), local, drives)).toBe('Nach testrechts kopiert')
    expect(entryLabel(t, entry('trash', 'left'), local, drives)).toBe('In testlinks gelöscht')
  })

  it("copies from a drive onto this device by the drive's name", () => {
    expect(entryLabel(t, entry('copy', 'left'), job('/data', 'volume:a1b2/x'), drives)).toBe(
      'Von Backup-Platte kopiert',
    )
  })

  it('keeps the plain word for a postponed file, which has no side', () => {
    expect(entryLabel(t, entry('skip', ''), cloud, drives)).toBe(de['entry.skip'])
  })

  it('keeps the plain word once the job is gone', () => {
    expect(entryLabel(t, entry('copy', 'right'), undefined, drives)).toBe(de['entry.copy'])
  })
})
