import { createContext, useContext } from 'react'

import type { Finding } from './anomalies'
import type { Job, RunEvent } from './api'

/**
 * What the shell keeps up to date from the engine's event stream, for a page
 * that is reached by an address and so gets nothing else from it.
 */
export type Live = {
  jobs: Job[]
  /** The open findings. */
  findings: Finding[]
  progress: Record<string, RunEvent>
  /** Bytes a second per running job. */
  speeds: Record<string, number>
  /** Asks for the jobs again after a page changed one. */
  onSaved: () => void
}

export const LiveJobs = createContext<Live>({ jobs: [], findings: [], progress: {}, speeds: {}, onSaved: () => {} })

export function useLive() {
  return useContext(LiveJobs)
}
