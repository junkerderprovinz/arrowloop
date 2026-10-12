import { useEffect, useState } from 'react'

/**
 * A choice kept in this browser, such as a list's filter and order, so it is
 * still set on the next visit. Storage that is off or full only forgets it.
 */
export function useRemembered<T>(key: string, initial: T, valid: (value: unknown) => value is T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initial
      const parsed: unknown = JSON.parse(raw)
      return valid(parsed) ? parsed : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // A private window or a full disk: the choice lasts until the page closes.
    }
  }, [key, value])
  return [value, setValue]
}
