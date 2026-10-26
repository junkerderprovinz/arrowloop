// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { CHANGES, compareReleases } from './whatsNew'
import { markSeen, recordFor, startWhatsNew, type NewsRecord } from './whatsNewStore'

const KEY = 'arrowloop.whatsNew'
const all = CHANGES.map((c) => c.id)
const since = (from: string) => CHANGES.filter((c) => compareReleases(c.after, from) >= 0).map((c) => c.id)
const before = (from: string) => CHANGES.filter((c) => compareReleases(c.after, from) < 0).map((c) => c.id)
const stored = (): NewsRecord => JSON.parse(localStorage.getItem(KEY) ?? 'null')

beforeEach(() => {
  localStorage.clear()
})

describe('what a browser remembers about the changes', () => {
  it('marks every change of a release after the one the browser had', () => {
    const was: NewsRecord = { version: 'v2.0.0', from: '1.9.0', seen: all }
    expect(recordFor(was, 'v2.3.0')).toEqual({ version: 'v2.3.0', from: '2.0.0', seen: before('2.0.0') })
  })

  it('keeps what was seen and left unseen of the older releases', () => {
    const older = before('2.2.0')
    const was: NewsRecord = { version: 'v2.2.0', from: '2.1.0', seen: older.slice(1) }
    expect(recordFor(was, 'dev').seen).toEqual(older.slice(1))
  })

  it('lists a browser that never saw an older release every change as already seen', () => {
    expect(recordFor(null, 'dev')).toEqual({ version: 'dev', from: '', seen: all })
  })

  it('turns nothing new after a build without a number', () => {
    const was: NewsRecord = { version: 'dev', from: '2.1.0', seen: all }
    expect(recordFor(was, 'v2.3.0')).toEqual({ version: 'v2.3.0', from: '2.1.0', seen: all })
  })

  it('shows no dots to a browser without a record', () => {
    startWhatsNew('dev')
    expect(stored().seen).toEqual(all)
  })

  it('keeps what was seen while the version stays', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 'v2.2.0', from: '2.1.0', seen: before('2.2.0') }))
    startWhatsNew('dev')
    markSeen([since('2.2.0')[0]])
    startWhatsNew('dev')
    expect(stored().seen).toContain(since('2.2.0')[0])
  })

  it('takes over the list of one release and counts everything it did not hold as seen', () => {
    const first = CHANGES.find((c) => c.after === '1.9.0')!.id
    localStorage.setItem(KEY, JSON.stringify({ version: 'v2.0.0', after: '1.9.0', seen: [first] }))
    startWhatsNew('v2.0.0')
    const took = stored()
    expect(took).toMatchObject({ version: 'v2.0.0', from: '1.9.0' })
    expect(took.seen.sort()).toEqual([first, ...CHANGES.filter((c) => c.after !== '1.9.0').map((c) => c.id)].sort())
  })

  it('brings a seen change back', () => {
    startWhatsNew('dev')
    markSeen([all[1]], false)
    expect(stored().seen).not.toContain(all[1])
    expect(stored().seen).toHaveLength(all.length - 1)
  })
})
