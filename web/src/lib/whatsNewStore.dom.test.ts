// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { RELEASES } from './whatsNew'
import { markSeen, recordFor, startWhatsNew, type NewsRecord } from './whatsNewStore'

const newest = RELEASES[0]
const ids = newest.changes.map((c) => c.id)
const stored = (): NewsRecord => JSON.parse(localStorage.getItem('arrowloop.whatsNew') ?? 'null')
const was: NewsRecord = { version: newest.after, after: '', seen: [] }

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('arrowloop.whatsNew', JSON.stringify(was))
})

describe('what a browser remembers about the changes', () => {
  it('marks every change after an update', () => {
    expect(recordFor(was, 'dev')).toEqual({ version: 'dev', after: newest.after, seen: [] })
  })

  it('lists a browser that never saw an older release its changes as already seen', () => {
    expect(recordFor(null, 'dev')).toMatchObject({ after: newest.after, seen: ids })
  })

  it('shows no dots to a browser without a record', () => {
    localStorage.clear()
    startWhatsNew('dev')
    expect(stored().seen).toEqual(ids)
  })

  it('keeps what was seen while the version stays', () => {
    startWhatsNew('dev')
    markSeen([ids[0]])
    startWhatsNew('dev')
    expect(stored().seen).toEqual([ids[0]])
  })

  it('starts over with all dots when the version changes', () => {
    startWhatsNew('dev')
    markSeen(ids)
    startWhatsNew(`v${newest.after}-3-gabc`)
    expect(stored()).toMatchObject({ seen: [] })
  })

  it('brings a seen change back', () => {
    startWhatsNew('dev')
    markSeen(ids)
    markSeen([ids[1]], false)
    expect(stored().seen).not.toContain(ids[1])
    expect(stored().seen).toHaveLength(ids.length - 1)
  })
})
