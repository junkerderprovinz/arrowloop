// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { at, basePath, inApp } from './base'
import { navigate } from './router'

function serveUnder(prefix: string) {
  const base = document.createElement('base')
  base.href = prefix
  document.head.prepend(base)
}

afterEach(() => document.querySelectorAll('base').forEach((b) => b.remove()))

describe('the interface under a prefix', () => {
  it('reaches the API at the root', () => {
    serveUnder('/')
    expect(at('/api/jobs')).toBe('/api/jobs')
    expect(basePath()).toBe('/')
    expect(inApp('/jobs/Fotos')).toBe('/jobs/Fotos')
  })

  it('reaches the API and names its pages under the prefix', () => {
    serveUnder('/fortress/open/0123abcd/')
    expect(at('/api/events')).toBe('/fortress/open/0123abcd/api/events')
    expect(at('/history?run=4#last')).toBe('/fortress/open/0123abcd/history?run=4#last')
    expect(basePath()).toBe('/fortress/open/0123abcd/')
    expect(inApp('/fortress/open/0123abcd/settings/pairing')).toBe('/settings/pairing')
    expect(inApp('/fortress/open/0123abcd/')).toBe('/')
  })

  it('moves between its pages under the prefix', () => {
    serveUnder('/fortress/open/0123abcd/')
    navigate('/settings/pairing')
    expect(window.location.pathname).toBe('/fortress/open/0123abcd/settings/pairing')
    expect(inApp(window.location.pathname)).toBe('/settings/pairing')
    window.history.replaceState(null, '', '/')
  })
})
