import { describe, expect, it } from 'vitest'

import { readCadence } from './cadence'

describe('readCadence', () => {
  it('reads a cron step as the interval it is', () => {
    expect(readCadence('0 */6 * * *', false)).toEqual({ kind: 'every', count: 6, unit: 'hour' })
    expect(readCadence('*/15 * * * *', false)).toEqual({ kind: 'every', count: 15, unit: 'minute' })
    expect(readCadence('30 2 */3 * *', false)).toEqual({ kind: 'every', count: 3, unit: 'day' })
    expect(readCadence('5 * * * *', false)).toEqual({ kind: 'every', count: 1, unit: 'hour' })
  })

  it('keeps an expression it cannot say in words as written', () => {
    expect(readCadence('0 */6 * * 1-5', false)).toEqual({ kind: 'cron', expression: '0 */6 * * 1-5' })
  })
})
