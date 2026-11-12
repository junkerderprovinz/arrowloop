// The server writes the path the interface lives under into the page's base
// element: the root, a reverse proxy's prefix, or the tab of another app of
// the fortress that opened this one. Every address goes by it, so the same
// build works under each.

/** Where the interface lives. A page without a base element, as under a test, lives at the root. */
function base(): string {
  return document.querySelector('base[href]') ? document.baseURI : new URL('/', location.href).href
}

/** The address of a path of this interface, given from its root as "/api/jobs". */
export function at(path: string): string {
  // Outside a page, as under a test without a DOM, there is no base to go by.
  if (typeof document === 'undefined') return path
  const url = new URL(path.replace(/^\/+/, ''), base())
  return url.pathname + url.search + url.hash
}

/** The path the interface lives under, ending in a slash. */
export function basePath(): string {
  return new URL(base()).pathname.replace(/[^/]*$/, '')
}

/** A browser path as the interface names it, from its own root. */
export function inApp(pathname: string): string {
  const root = basePath()
  return pathname.startsWith(root) ? `/${pathname.slice(root.length)}` : pathname
}
