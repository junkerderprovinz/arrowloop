// Whether the anomaly notes and their page are switched on. The engine keeps
// the switch; the rail, the routes and a held job's badge read it from here,
// so a change in Settings reaches them without a reload.

import { useSyncExternalStore } from 'react'

import type { Settings } from './api'

let on: boolean | null = null
const listeners = new Set<() => void>()

/** Takes the switch from the engine's settings, as they were read or saved. */
export function followSettings(settings: Settings) {
  const next = settings.anomalies?.off !== true
  if (next === on) return
  on = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Null until the settings have been read. */
export function useAnomaliesOn(): boolean | null {
  return useSyncExternalStore(subscribe, () => on)
}
