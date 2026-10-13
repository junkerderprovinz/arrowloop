import { describe, expect, it } from 'vitest'

import {
  BRAKE_SETTINGS,
  SYNC_SETTINGS,
  describeOwn,
  exceptionsOf,
  inForce,
  inheritAll,
  inheritPatch,
  owns,
} from './follows'
import { modesHint } from './modes'
import { en, type Translate } from './i18n.data'

const t: Translate = (key, vars) =>
  en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`))

describe('a setting a job takes from the defaults', () => {
  it('follows them while the job holds no value of its own', () => {
    const job = { name: 'a', quietPeriod: '', transfers: 0, direction: '' }
    for (const setting of [...SYNC_SETTINGS, ...BRAKE_SETTINGS]) {
      expect(owns(job, setting), setting).toBe(false)
    }
  })

  it('counts an empty schedule as the job\'s own, since that job runs only when asked', () => {
    expect(owns({ schedule: '' }, 'schedule')).toBe(true)
  })

  it('counts a watching job\'s schedule as its own, since the default cannot watch', () => {
    expect(owns({ watch: true }, 'schedule')).toBe(true)
  })

  it('counts a switch turned off as a value of its own', () => {
    expect(owns({ emptyDirs: false }, 'emptyDirs')).toBe(true)
    expect(owns({ brakePercent: 0 }, 'brakePercent')).toBe(true)
  })

  it('goes back by clearing every field the setting writes', () => {
    const job = { direction: 'leftToRight', mode: 'mirror', schedule: '@every 1h', watch: true, watchSettle: '5s' }
    const back = { ...job, ...inheritPatch('direction'), ...inheritPatch('schedule') }
    expect(owns(back, 'direction')).toBe(false)
    expect(owns(back, 'schedule')).toBe(false)
    expect(JSON.parse(JSON.stringify(back))).toEqual({})
  })

  it('overrides with the value in force, so nothing about the job changes', () => {
    expect(inForce({ direction: 'rightToLeft', mode: 'move' }, 'direction')).toEqual({
      direction: 'rightToLeft',
      mode: 'move',
    })
    expect(inForce({ schedule: '0 3 * * *' }, 'schedule')).toEqual({ schedule: '0 3 * * *' })
    expect(inForce(undefined, 'emptyDirs')).toEqual({ emptyDirs: false })
    // Unset defaults are the engine's own values.
    expect(inForce({}, 'quietPeriod')).toEqual({ quietPeriod: '5s' })
    expect(inForce({}, 'brakePercent')).toEqual({ brakePercent: 50 })
  })

  it('writes copy only when a two-way job overrides a default mirror', () => {
    // The engine refuses a mirror that runs both ways.
    expect(inForce({ direction: 'both', mode: 'mirror' }, 'direction').mode).toBe('sync')
  })
})

describe('the exceptions', () => {
  const jobs = [
    { name: 'follows' },
    { name: 'own', schedule: '0 3 * * *', emptyDirs: true, brakePercent: 20 },
    { name: 'brakes only', changePercent: 5 },
  ]

  it('lists only the jobs that differ, with the settings that differ', () => {
    expect(exceptionsOf(jobs, SYNC_SETTINGS)).toEqual([{ name: 'own', own: ['schedule', 'emptyDirs'] }])
    expect(exceptionsOf(jobs, BRAKE_SETTINGS)).toEqual([
      { name: 'own', own: ['brakePercent'] },
      { name: 'brakes only', own: ['changePercent'] },
    ])
  })

  it('is empty once every job follows the defaults', () => {
    const back = jobs.map((job) => ({ ...job, ...inheritAll([...SYNC_SETTINGS, ...BRAKE_SETTINGS]) }))
    expect(exceptionsOf(back, SYNC_SETTINGS)).toEqual([])
    expect(exceptionsOf(back, BRAKE_SETTINGS)).toEqual([])
  })

  it('names each value in words', () => {
    expect(describeOwn({ schedule: '30 3 * * *' }, 'schedule', t)).toBe('Schedule: daily at 03:30')
    expect(describeOwn({ schedule: '' }, 'schedule', t)).toBe('Schedule: on request')
    expect(describeOwn({ direction: 'leftToRight', mode: 'mirror' }, 'direction', t)).toBe(
      'Direction: Only to the right, Mirror',
    )
    expect(describeOwn({ emptyDirs: true }, 'emptyDirs', t)).toBe(`${en['edit.emptyDirs']}: On`)
    expect(describeOwn({ quietPeriod: '30s' }, 'quietPeriod', t)).toBe('Quiet period: 30s')
    expect(describeOwn({ brakePercent: 20 }, 'brakePercent', t)).toBe(`${en['engine.brakePercent']}: 20 %`)
  })
})

describe('the mode bubble', () => {
  it('explains all three modes by name', () => {
    const said = modesHint((key) => en[key])
    for (const m of ['sync', 'mirror', 'move'] as const) {
      expect(said).toContain(`${en[`mode.${m}`]}: ${en[`mode.${m}Hint`]}`)
    }
  })
})
