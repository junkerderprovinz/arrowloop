import { createContext, useContext } from 'react'

/**
 * Opens a job's own page. A context rather than a prop, since the rows and
 * links that lead there sit several components below the page, and only the
 * shell knows where that page lives.
 */
export const OpenJob = createContext<(name: string) => void>(() => {})

export function useOpenJob() {
  return useContext(OpenJob)
}
