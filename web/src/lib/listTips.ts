// Which pages have shown their list's hint line by itself, kept per browser.
// The line shows once, on the first visit, and on hover after that.

const KEY = 'arrowloop.list.tips'

function seen(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

/** Whether this is the page's first visit, which it stops being as soon as it is asked. */
export function firstVisit(page: string): boolean {
  const pages = seen()
  if (pages.includes(page)) return false
  try {
    localStorage.setItem(KEY, JSON.stringify([...pages, page]))
  } catch {
    // Storage that is off shows the line on every visit, which is the safe side.
  }
  return true
}
