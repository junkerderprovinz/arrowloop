import { useMemo, useSyncExternalStore, type ComponentProps } from 'react'

// The browser's own history is the router's state, which is all an app of a
// dozen addresses needs: a bookmark, Back and Ctrl-click work without a
// routing library.

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

const here = () => window.location.pathname + window.location.search

/**
 * Goes to an address inside the app. Asking for the address already shown adds
 * no history entry, so Back still leaves it in one step.
 */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (to === here()) return
  if (replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  for (const listener of listeners) listener()
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const at = useSyncExternalStore(subscribe, here)
  return useMemo(() => {
    const url = new URL(at, window.location.origin)
    return { pathname: url.pathname, search: url.searchParams }
  }, [at])
}

/**
 * A real link, so the browser offers to open it beside the current page, that
 * goes there without a reload on a plain click.
 */
export function Link({ to, onClick, ...rest }: Omit<ComponentProps<'a'>, 'href'> & { to: string }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(to)
      }}
    />
  )
}
