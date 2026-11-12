// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { standInForRefusedStorage } from './storageShim'

const kept = {
  local: Object.getOwnPropertyDescriptor(window, 'localStorage'),
  session: Object.getOwnPropertyDescriptor(window, 'sessionStorage'),
  cookie: Object.getOwnPropertyDescriptor(document, 'cookie'),
}

function refuse(target: object, name: string) {
  Object.defineProperty(target, name, {
    configurable: true,
    get: () => {
      throw new DOMException('The document is sandboxed and lacks the allow-same-origin flag.', 'SecurityError')
    },
    set: () => {
      throw new DOMException('The document is sandboxed and lacks the allow-same-origin flag.', 'SecurityError')
    },
  })
}

afterEach(() => {
  for (const [target, name, d] of [
    [window, 'localStorage', kept.local],
    [window, 'sessionStorage', kept.session],
    [document, 'cookie', kept.cookie],
  ] as const) {
    if (d) Object.defineProperty(target, name, d)
    else delete (target as unknown as Record<string, unknown>)[name]
  }
})

describe('a page in an origin of its own', () => {
  it('keeps what it stores in memory where the browser refuses storage', () => {
    refuse(window, 'localStorage')
    refuse(window, 'sessionStorage')
    standInForRefusedStorage()
    window.localStorage.setItem('arrowloop-theme', 'dark')
    window.sessionStorage.setItem('tab', 'jobs')
    expect(window.localStorage.getItem('arrowloop-theme')).toBe('dark')
    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.key(0)).toBe('arrowloop-theme')
    expect(window.sessionStorage.getItem('tab')).toBe('jobs')
    window.localStorage.removeItem('arrowloop-theme')
    expect(window.localStorage.getItem('arrowloop-theme')).toBeNull()
  })

  it('keeps cookies in memory and lets an expired one go', () => {
    refuse(document, 'cookie')
    standInForRefusedStorage()
    document.cookie = 'lang=de; path=/; SameSite=Lax'
    document.cookie = 'seen=1'
    expect(document.cookie).toBe('lang=de; seen=1')
    document.cookie = 'seen=; Max-Age=0'
    expect(document.cookie).toBe('lang=de')
  })

  it('leaves storage that works alone', () => {
    const before = window.localStorage
    before.setItem('kept', 'yes')
    standInForRefusedStorage()
    expect(window.localStorage).toBe(before)
    expect(window.localStorage.getItem('kept')).toBe('yes')
    before.removeItem('kept')
  })
})
