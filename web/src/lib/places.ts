import { createContext, useContext } from 'react'

import type { Drive, Job } from './entryLabel'

/** The jobs and drives the log needs to name a side, provided once by App. */
export const Places = createContext<{ jobs: Job[]; drives: Drive[] }>({ jobs: [], drives: [] })

export function usePlaces() {
  return useContext(Places)
}
