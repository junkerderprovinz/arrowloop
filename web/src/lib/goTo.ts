import { createContext, useContext } from 'react'

/** A tab another screen can send somebody to, narrowed to one job. */
export type Place = { tab: 'conflicts' | 'trash'; job: string }

/**
 * Switches the page to a place. A context rather than a prop, because the
 * screens that link there sit several components below the page.
 */
export const GoTo = createContext<(place: Place) => void>(() => {})

export function useGoTo() {
  return useContext(GoTo)
}
