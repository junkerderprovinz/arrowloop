import { describe, expect, it } from 'vitest'

import { followPatch, followsDefaults } from './follows'
import { modesHint } from './modes'
import { en } from './i18n.data'

describe('a job and the global sync settings', () => {
  it('follows them while it sets none of their fields', () => {
    expect(followsDefaults({ name: 'a', left: '/x', right: 'box:', quietPeriod: '5s' })).toBe(true)
    expect(followsDefaults({ name: 'a', schedule: '' })).toBe(false)
    expect(followsDefaults({ name: 'a', emptyDirs: false })).toBe(false)
  })

  it('is linked again by clearing every field they own', () => {
    const job = { name: 'a', direction: 'leftToRight' as const, mode: 'mirror' as const, metadata: true }
    expect(followsDefaults({ ...job, ...followPatch(true, undefined) })).toBe(true)
  })

  it('keeps what it runs with when it is cut loose', () => {
    const patch = followPatch(false, {
      direction: 'leftToRight',
      mode: 'mirror',
      schedule: '0 3 * * *',
      metadata: true,
    })
    expect(patch).toEqual({
      direction: 'leftToRight',
      mode: 'mirror',
      schedule: '0 3 * * *',
      emptyDirs: false,
      metadata: true,
    })
    expect(followsDefaults(patch)).toBe(false)
  })

  it('copies only once cut loose as a two-way job', () => {
    // A mode left unset would take a default mirror, which the engine refuses
    // for a job that runs both ways.
    const patch = followPatch(false, { direction: 'both', mode: 'mirror' })
    expect(patch.direction).toBe('both')
    expect(patch.mode).toBe('sync')
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
