import { describe, expect, it } from 'vitest'

import { buildSchedule, chooseKind, parseSchedule, readSchedule } from './schedule.data'

describe('a stored schedule', () => {
  const stored = [
    { raw: '', kind: 'off' },
    { raw: '@every 30m', kind: 'every', count: 30, unit: 'minute' },
    { raw: '@every 6h', kind: 'every', count: 6, unit: 'hour' },
    { raw: '@every 36h', kind: 'every', count: 36, unit: 'hour' },
    { raw: '@every 48h', kind: 'every', count: 2, unit: 'day' },
    { raw: '@every 336h', kind: 'every', count: 2, unit: 'week' },
    { raw: '0 3 * * *', kind: 'daily', time: '03:00' },
    { raw: '45 23 * * *', kind: 'daily', time: '23:45' },
    { raw: '15 4 * * 1', kind: 'weekly', time: '04:15', days: [1] },
    { raw: '30 22 * * 0,3,5', kind: 'weekly', time: '22:30', days: [0, 3, 5] },
    { raw: '0 */6 * * *', kind: 'cron' },
    { raw: '15 2 * * 1-5', kind: 'cron' },
    { raw: '@daily', kind: 'cron' },
    { raw: '@every 1h30m', kind: 'cron' },
  ] as const

  for (const { raw, ...want } of stored) {
    it(`reads ${raw || 'nothing'} as ${want.kind} and writes it back unchanged`, () => {
      const state = parseSchedule(raw)
      expect(state.mode).toBe(want.kind)
      if ('count' in want) expect([state.everyCount, state.everyUnit]).toEqual([want.count, want.unit])
      if ('time' in want) expect(state.time).toBe(want.time)
      if ('days' in want) expect(state.days).toEqual(want.days)
      expect(buildSchedule(state)).toBe(raw)
    })
  }

  it('reads a watching job as real time, its expression being the backstop', () => {
    const state = readSchedule('@every 1h', true)
    expect(state.mode).toBe('live')
    expect([state.everyCount, state.everyUnit]).toEqual([1, 'hour'])
    expect(buildSchedule(state)).toBe('@every 1h')
    expect(readSchedule('@every 1h', false).mode).toBe('every')
  })

  it('keeps the meaning of an expression typed by hand in another spelling', () => {
    expect(buildSchedule(parseSchedule('05 03 * * *'))).toBe('5 3 * * *')
    expect(buildSchedule(parseSchedule('0 3 * * 5,1'))).toBe('0 3 * * 1,5')
    expect(buildSchedule(parseSchedule('  0 3 * * *  '))).toBe('0 3 * * *')
  })
})

describe('choosing another kind', () => {
  it('gives real time an hourly backstop and a settle time when there was neither', () => {
    const choice = chooseKind(parseSchedule(''), '', '', 'live')
    expect(choice).toMatchObject({ schedule: '@every 1h', watch: true, settle: '5s' })
  })

  it('keeps the cadence and the settle time real time finds', () => {
    const choice = chooseKind(parseSchedule('@every 6h'), '@every 6h', '30s', 'live')
    expect(choice.schedule).toBe('@every 6h')
    expect(choice.settle).toBeUndefined()
  })

  it('stops watching once real time is left', () => {
    const live = readSchedule('@every 1h', true)
    expect(chooseKind(live, '@every 1h', '5s', 'daily')).toMatchObject({ schedule: '0 3 * * *', watch: false })
  })

  it('starts cron from the schedule already set, written out', () => {
    expect(chooseKind(parseSchedule('15 4 * * 1'), '15 4 * * 1', '', 'cron').schedule).toBe('15 4 * * 1')
    expect(chooseKind(parseSchedule(''), '', '', 'cron').schedule).toBe('0 3 * * *')
    expect(chooseKind(readSchedule('@every 1h', true), '@every 1h', '5s', 'cron').schedule).toBe('0 3 * * *')
  })

  it('writes nothing for a job that runs only when started', () => {
    expect(chooseKind(parseSchedule('0 3 * * *'), '0 3 * * *', '', 'off')).toMatchObject({ schedule: '', watch: false })
  })
})
