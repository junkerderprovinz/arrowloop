// What this browser remembers about the changes of the running version: which
// release is marked and which of its changes were seen.
// Kept per browser, since one person's click must not hide a dot for
// everybody who opens the same engine.

import { useMemo, useSyncExternalStore } from 'react'

import { RELEASES, releaseSince, type Change } from './whatsNew'

const KEY = 'arrowloop.whatsNew'

export interface NewsRecord {
  /** The version the record was made for. Another one starts it over. */
  version: string
  /** The `after` of the release whose changes are listed, '' for none. */
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

function isRecord(value: unknown): value is NewsRecord {
  const r = value as NewsRecord | null
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.version === 'string' &&
    typeof r.after === 'string' &&
    Array.isArray(r.seen)
  )
}

function parse(raw: string): NewsRecord | null {
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null
    return isRecord(stored) ? stored : null
  } catch {
    return null
  }
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

/** The changes a record lists. */
function changesOf(record: NewsRecord | null): Change[] {
  return RELEASES.find((r) => r.after === record?.after)?.changes ?? []
}

/**
 * The record for the running version, given the one kept last. The same
 * version keeps its record; another starts over with every dot of the release
 * the update passed. With nothing kept, `settled` tells an engine that was in
 * use before this browser kept records from a new install: the first gets the
 * dots of the newest release, the second its list with every change already
 * seen, so "Show all again" can still bring them out.
 */
export function recordFor(stored: NewsRecord | null, running: string, settled: boolean): NewsRecord {
  if (stored?.version === running) return stored
  if (stored || settled) {
    return { version: running, after: releaseSince(stored?.version ?? '', running)?.after ?? '', seen: [] }
  }
  const newest = releaseSince('', running)
  return { version: running, after: newest?.after ?? '', seen: newest?.changes.map((c) => c.id) ?? [] }
}

/** Settles the record once the running version and whether the engine was in use are known. */
export function startWhatsNew(running: string, settled: boolean) {
  const stored = parse(readRaw())
  const next = recordFor(stored, running, settled)
  if (next !== stored) write(next)
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
  /** Every change the record lists, seen or not. */
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
    const changes = changesOf(record)
    const seen = new Set(record.seen)
    return { version: record.version, changes, seen, unseen: changes.filter((c) => !seen.has(c.id)) }
  }, [raw])
}
