// How many targets and drives are saved, as last read. The Targets page sets it
// after every change it makes, so the count on its settings tile follows
// without asking the engine again.

import { useEffect, useSyncExternalStore } from 'react'

import { api } from './api'

export interface TargetCount {
  targets: number
  drives: number
}

let current: TargetCount | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTargetCount(next: TargetCount) {
  if (current?.targets === next.targets && current.drives === next.drives) return
  current = next
  for (const listener of listeners) listener()
}

/**
 * The saved count, read from the engine once on arrival since a pinned page is
 * not drawn here to report it. Null until the first answer.
 */
export function useTargetCount(): TargetCount | null {
  useEffect(() => {
    Promise.all([api.remotes(), api.volumes()])
      .then(([r, v]) => setTargetCount({ targets: r.remotes.length, drives: v.volumes.length }))
      .catch(() => {})
  }, [])
  return useSyncExternalStore(subscribe, () => current)
}
