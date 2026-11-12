// A page another app of the fortress opens runs sandboxed, in an origin of its
// own, where the browser throws on localStorage, sessionStorage and
// document.cookie. Memory stands in for them there, so the interface works
// and forgets everything when the tab closes. Where storage works this
// changes nothing.

/** A Storage that lives as long as the page. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>()

  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(key: string) {
    return this.items.get(String(key)) ?? null
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.items.delete(String(key))
  }
  setItem(key: string, value: string) {
    this.items.set(String(key), String(value))
  }
}

function refused(read: () => unknown): boolean {
  try {
    read()
    return false
  } catch {
    return true
  }
}

/** Puts memory where the browser refuses storage or cookies. */
export function standInForRefusedStorage(): void {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (refused(() => window[name].length)) {
      Object.defineProperty(window, name, { value: new MemoryStorage(), configurable: true })
    }
  }
  if (refused(() => document.cookie)) {
    const jar = new Map<string, string>()
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      set: (line: string) => {
        const [pair = '', ...attributes] = String(line).split(';')
        const at = pair.indexOf('=')
        const name = (at < 0 ? '' : pair.slice(0, at)).trim()
        if (!name) return
        const gone = attributes.some((a) => {
          const [key = '', value = ''] = a.split('=').map((p) => p.trim().toLowerCase())
          return (key === 'max-age' && Number(value) <= 0) || (key === 'expires' && Date.parse(value) <= Date.now())
        })
        if (gone) jar.delete(name)
        else jar.set(name, pair.slice(at + 1).trim())
      },
    })
  }
}

standInForRefusedStorage()
