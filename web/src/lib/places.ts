import { createContext, useContext } from 'react'

import type { Drive, Job } from './entryLabel'

/**
 * The jobs, drives and targets the log needs to name a side, provided once by
 * App. A target's label is looked up in targetLabels; the targets are here so
 * a page names them again once they are read.
 */
export const Places = createContext<{ jobs: Job[]; drives: Drive[]; targets: { name: string; label?: string }[] }>({
  jobs: [],
  drives: [],
  targets: [],
})

export function usePlaces() {
  return useContext(Places)
}
