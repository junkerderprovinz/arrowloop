import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { en } from './i18n'
import {
  broughtBy,
  CHANGES,
  compareReleases,
  isAt,
  isRelease,
  matchRoute,
  placed,
  RELEASES,
  releaseNumber,
  sentenceOf,
  trail,
  type Change,
} from './whatsNew'

const NOTES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.github', 'release-notes')
const NOTED = readdirSync(NOTES)
  .map((name) => /^v(\d+\.\d+\.\d+)\.md$/.exec(name)?.[1])
  .filter((v) => v !== undefined)

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
    const listBar = CHANGES.find((c) => c.id === 'list-bar')!
    expect(placed(listBar) && isAt(listBar, '/history')).toBe(true)
  })
})

describe('the release a change came with', () => {
  const change = (after: string) => ({ id: 'x', text: 'new.title', after }) as Change

  it('is the oldest release past the one before it', () => {
    expect(broughtBy(change('2.1.0'), ['2.2.1', '2.1.0', '2.2.0', '1.9.0'])).toBe('2.2.0')
  })

  it('is none yet in a build of what comes next', () => {
    expect(broughtBy(change('2.2.3'), ['2.2.3', '2.2.0'])).toBeUndefined()
  })

  it('reads the number a build starts from, and tells a release from a build between two', () => {
    expect(releaseNumber('v2.2.3-4-gabcdef')).toBe('2.2.3')
    expect(releaseNumber('dev')).toBeNull()
    expect(isRelease('v2.2.3')).toBe(true)
    expect(isRelease('2.2.3+main')).toBe(true)
    expect(isRelease('v2.2.3-4-gabcdef')).toBe(false)
    expect(compareReleases('2.10.0', '2.9.1')).toBeGreaterThan(0)
  })
})

describe('the list of changes', () => {
  it('names each release once, newest first, after a release that exists', () => {
    const afters = RELEASES.map((r) => r.after)
    expect(afters.every((after, i) => i === 0 || compareReleases(afters[i - 1], after) > 0)).toBe(true)
    for (const after of afters) expect(NOTED, after).toContain(after)
  })

  it('names each change once', () => {
    const ids = CHANGES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // From 2.2.0 on, every feature a release adds under Added in its notes gets
  // a change of its own, on a page or in the list alone.
  it('gives every feature a release adds a change of its own', () => {
    const short: string[] = []
    for (const version of NOTED) {
      if (compareReleases(version, '2.2.0') < 0) continue
      const notes = readFileSync(join(NOTES, `v${version}.md`), 'utf8')
      const added = /^## .*Added\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(notes)?.[1] ?? ''
      const features = added.split('\n').filter((line) => line.startsWith('- ')).length
      const changes = CHANGES.filter((c) => broughtBy(c, NOTED) === version).length
      if (changes < features) short.push(`${version}: ${features} added, ${changes} listed`)
    }
    expect(short).toEqual([])
  })

  it('names the page of every change a page draws', () => {
    for (const change of CHANGES.filter(placed)) expect(change.where.length, change.id).toBeGreaterThan(0)
  })

  it('fills every label a sentence quotes', () => {
    const t = (key: keyof typeof en, vars?: Record<string, string | number>) =>
      en[key].replace(/\{(\w+)\}/g, (all, name: string) => String(vars?.[name] ?? all))
    for (const change of CHANGES) expect(sentenceOf(t, change)).not.toMatch(/\{\w+\}/)
  })
})
