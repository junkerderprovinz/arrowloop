// What this browser remembers about the changes: the release it had open
// before the last update and which changes it has seen.
// Kept per browser, since one person's click must not hide a dot for
// everybody who opens the same engine.

import { useMemo, useSyncExternalStore } from 'react'

import { CHANGES, compareReleases, releaseNumber, type Change } from './whatsNew'

const KEY = 'arrowloop.whatsNew'

export interface NewsRecord {
  /** The version the record was made for. Another one means an update. */
  version: string
  /** The release this browser had open before the last update, as x.y.z, '' for none. */
  from: string
  seen: string[]
}

/**
 * A record from the versions that listed the changes of one release only,
 * named by its `after`. The first read takes it over.
 */
interface OneReleaseRecord {
  version: string
  after: string
  seen: string[]
}

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

const isIds = (list: unknown): list is string[] => Array.isArray(list) && list.every((id) => typeof id === 'string')

/** The record a one-release list becomes: what that list did not hold had no dot then and gets none now. */
function takeOver(old: OneReleaseRecord): NewsRecord {
  const others = CHANGES.filter((c) => c.after !== old.after).map((c) => c.id)
  return { version: old.version, from: old.after, seen: [...old.seen, ...others.filter((id) => !old.seen.includes(id))] }
}

function parse(raw: string): NewsRecord | null {
  try {
    const r = (raw ? JSON.parse(raw) : null) as Partial<NewsRecord & OneReleaseRecord> | null
    if (!r || typeof r !== 'object' || typeof r.version !== 'string' || !isIds(r.seen)) return null
    if (typeof r.from === 'string') return { version: r.version, from: r.from, seen: r.seen }
    if (typeof r.after === 'string') return takeOver({ version: r.version, after: r.after, seen: r.seen })
  } catch {
    // Anything else in the slot counts as nothing kept.
  }
  return null
}

const listeners = new Set<() => void>()

function write(next: NewsRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    return
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/**
 * The record for the running version, given the one kept last. The same
 * version keeps its record. After an update every change of a release newer
 * than the one the browser had is new, and what it had seen of the older ones
 * stays seen. A browser with nothing kept never saw an older release, so every
 * change starts as seen, and "Show all again" can still bring them out.
 */
export function recordFor(stored: NewsRecord | null, running: string): NewsRecord {
  if (!stored) return { version: running, from: '', seen: CHANGES.map((c) => c.id) }
  if (stored.version === running) return stored
  const from = releaseNumber(stored.version)
  // A build without a number says nothing about which changes it showed.
  if (!from) return { ...stored, version: running }
  const older = new Set(CHANGES.filter((c) => compareReleases(c.after, from) < 0).map((c) => c.id))
  return { version: running, from, seen: stored.seen.filter((id) => older.has(id)) }
}

/**
 * Settles the record once the running version is known. After an update this
 * browser saw the version before, the window opens by itself.
 */
export function startWhatsNew(running: string) {
  const raw = readRaw()
  const stored = parse(raw)
  const next = recordFor(stored, running)
  if (JSON.stringify(next) !== raw) write(next)
  if (stored && stored.version !== running) openNewsWindow()
}

let windowOpen = false
const windowListeners = new Set<() => void>()

function setWindow(open: boolean) {
  windowOpen = open
  for (const listener of windowListeners) listener()
}

/** Opens the one window the Version card and an update share. */
export function openNewsWindow() {
  setWindow(true)
}

export function closeNewsWindow() {
  setWindow(false)
}

export function useNewsWindow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      windowListeners.add(listener)
      return () => windowListeners.delete(listener)
    },
    () => windowOpen,
  )
}

function update(fields: (record: NewsRecord) => Partial<NewsRecord>) {
  const stored = parse(readRaw())
  if (stored) write({ ...stored, ...fields(stored) })
}

/** Counts changes as seen, or as new again. */
export function markSeen(ids: string[], seen = true) {
  update((record) => {
    const rest = record.seen.filter((id) => !ids.includes(id))
    return { seen: seen ? [...rest, ...ids] : rest }
  })
}

export interface WhatsNew {
  /** The version the record was made for. */
  version: string
  /** The release this browser had open before the last update, as x.y.z, '' for none. */
  from: string
  /** The changes that came after `from`, and any older one still unseen. */
  changes: Change[]
  seen: ReadonlySet<string>
  unseen: Change[]
}

/** The running version's record, or null until startWhatsNew has settled it. */
export function useWhatsNew(): WhatsNew | null {
  const raw = useSyncExternalStore(subscribe, readRaw)
  return useMemo(() => {
    const record = parse(raw)
    if (!record) return null
    const seen = new Set(record.seen)
    const since = (c: Change) => record.from !== '' && compareReleases(c.after, record.from) >= 0
    return {
      version: record.version,
      from: record.from,
      changes: CHANGES.filter((c) => since(c) || !seen.has(c.id)),
      seen,
      unseen: CHANGES.filter((c) => !seen.has(c.id)),
    }
  }, [raw])
}
