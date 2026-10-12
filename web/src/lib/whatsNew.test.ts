import { describe, expect, it } from 'vitest'

import { en } from './i18n'
import { isAt, matchRoute, RELEASES, releaseSince, sentenceOf, trail, type Release } from './whatsNew'

const releases: Release[] = [
  { after: '1.9.0', changes: [] },
  { after: '1.8.0', changes: [] },
]

describe('the way to a change', () => {
  it('leads through every section above the page', () => {
    expect(trail('/settings/info', '/jobs')).toEqual(['/settings', '/settings/info'])
  })

  it('leaves out the section the reader is in', () => {
    expect(trail('/settings/info', '/settings/look')).toEqual(['/settings/info'])
  })

  it('reaches a page of one entry through the list that holds it', () => {
    expect(trail('/jobs/:name', '/jobs')).toEqual(['/jobs/:name'])
    expect(trail('/jobs/:name', '/history')).toEqual(['/jobs', '/jobs/:name'])
  })

  it('ends where the reader already is', () => {
    expect(trail('/jobs/:name', '/jobs/photos')).toEqual([])
  })

  it('matches a named segment against any one segment', () => {
    expect(matchRoute('/settings/:tile', '/settings/look')).toBe(true)
    expect(matchRoute('/settings/:tile', '/settings')).toBe(false)
    expect(isAt(RELEASES[0].changes.find((c) => c.id === 'list-bar')!, '/history')).toBe(true)
  })
})

describe('the release an update passes', () => {
  it('is the newest one between the two versions', () => {
    expect(releaseSince('1.8.0', '1.9.0', releases)?.after).toBe('1.8.0')
    expect(releaseSince('1.8.0', '2.0.0', releases)?.after).toBe('1.9.0')
  })

  it('is none for a patch of the same release', () => {
    expect(releaseSince('1.9.0', '1.9.1', [{ after: '1.8.0', changes: [] }])).toBeUndefined()
  })

  it('treats a build without a release number as the next release', () => {
    expect(releaseSince('v1.8.0', 'dev', releases)?.after).toBe('1.9.0')
    expect(releaseSince('1.8.0', 'v1.8.0-12-gabcdef', [{ after: '1.8.0', changes: [] }])?.after).toBe('1.8.0')
  })
})

describe('the list of changes', () => {
  const changes = RELEASES.flatMap((r) => r.changes)

  it('names each change once within a release', () => {
    for (const release of RELEASES) {
      const ids = release.changes.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('fills every label a sentence quotes', () => {
    const t = (key: keyof typeof en, vars?: Record<string, string | number>) =>
      en[key].replace(/\{(\w+)\}/g, (all, name: string) => String(vars?.[name] ?? all))
    for (const change of changes) expect(sentenceOf(t, change)).not.toMatch(/\{\w+\}/)
  })
})
