// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { RELEASES } from './whatsNew'
import { markSeen, recordFor, startWhatsNew, type NewsRecord } from './whatsNewStore'

const newest = RELEASES[0]
const ids = newest.changes.map((c) => c.id)
const stored = (): NewsRecord => JSON.parse(localStorage.getItem('arrowloop.whatsNew') ?? 'null')

beforeEach(() => localStorage.clear())

describe('what a browser remembers about the changes', () => {
  it('marks every change after an update', () => {
    const was: NewsRecord = { version: newest.after, after: '', seen: [] }
    expect(recordFor(was, 'dev', true)).toEqual({ version: 'dev', after: newest.after, seen: [] })
  })

  it('marks the newest changes for an engine that was in use before this browser kept a record', () => {
    expect(recordFor(null, 'dev', true)).toMatchObject({ after: newest.after, seen: [] })
  })

  it('lists a new install its changes as already seen', () => {
    expect(recordFor(null, 'dev', false)).toMatchObject({ after: newest.after, seen: ids })
  })

  it('keeps what was seen while the version stays', () => {
    startWhatsNew('dev', true)
    markSeen([ids[0]])
    startWhatsNew('dev', true)
    expect(stored().seen).toEqual([ids[0]])
  })

  it('starts over with all dots when the version changes', () => {
    startWhatsNew('dev', true)
    markSeen(ids)
    startWhatsNew(`v${newest.after}-3-gabc`, true)
    expect(stored()).toMatchObject({ seen: [] })
  })

  it('brings a seen change back', () => {
    startWhatsNew('dev', true)
    markSeen(ids)
    markSeen([ids[1]], false)
    expect(stored().seen).not.toContain(ids[1])
    expect(stored().seen).toHaveLength(ids.length - 1)
  })
})
