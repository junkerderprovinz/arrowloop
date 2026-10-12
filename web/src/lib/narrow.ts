import { useEffect, useState } from 'react'

/** The width below which the rail turns into a bar and a window into a sheet. */
export const NARROW_QUERY = '(max-width: 639px)'

/** Whether the window is phone-narrow, following it as it is resized. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY).matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY)
    if (!query) return
    const follow = () => setNarrow(query.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])
  return narrow
}
