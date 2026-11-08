// Which of the pages that can leave the sidebar stand in it. The choice belongs to the person
// at this browser, like the remembered settings tile.

import { useMemo, useSyncExternalStore } from 'react'

export type NavPins = { dashboard: boolean; targets: boolean; instances: boolean }

const KEY = 'arrowloop.navPins'

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** The Overview starts in the sidebar; Targets and Instances start on their tiles, until somebody pins them. */
export function parsePins(raw: string): NavPins {
  const pins: NavPins = { dashboard: true, targets: false, instances: false }
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (stored && typeof stored === 'object') {
      for (const id of Object.keys(pins) as (keyof NavPins)[]) {
        const value = (stored as Record<string, unknown>)[id]
        if (typeof value === 'boolean') pins[id] = value
      }
    }
  } catch {
    // A hand-edited value falls back to the defaults rather than breaking the rail.
  }
  return pins
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab of the app pinning a page moves this tab's rail too.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export function setNavPin(id: keyof NavPins, pinned: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...parsePins(readRaw()), [id]: pinned }))
  } catch {
    return
  }
  for (const listener of listeners) listener()
}

export function useNavPins(): NavPins {
  const raw = useSyncExternalStore(subscribe, readRaw)
  return useMemo(() => parsePins(raw), [raw])
}
