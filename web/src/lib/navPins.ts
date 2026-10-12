// Which settings pages also stand in the sidebar. The choice belongs to the
// person at this browser, like the remembered settings page.

import { useMemo, useSyncExternalStore } from 'react'

import type { ModuleId } from './routes'

export type NavPins = Record<ModuleId, boolean>

const KEY = 'arrowloop.navPins'

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** Both start on their tile only; the sidebar keeps its four places until somebody pins one. */
export function parsePins(raw: string): NavPins {
  const pins: NavPins = { targets: false, anomalies: false }
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (stored && typeof stored === 'object') {
      for (const id of Object.keys(pins) as ModuleId[]) {
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

export function setNavPin(id: ModuleId, pinned: boolean) {
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
