import { describe, expect, it } from 'vitest'

import { KINDS, newChannel, sends } from './notify'

describe('the notification channels', () => {
  it('get an id no other channel has', () => {
    const first = newChannel('discord', [])
    const second = newChannel('discord', [first])
    const third = newChannel('discord', [first, second])
    expect(new Set([first.id, second.id, third.id]).size).toBe(3)
  })

  it('start switched on with the block of their service', () => {
    for (const kind of KINDS) {
      const c = newChannel(kind, [])
      expect(c.kind).toBe(kind)
      expect(c.enabled).toBe(true)
      expect(c[kind]).toBeDefined()
    }
  })

  it('report failures unless told otherwise, and Healthchecks every run', () => {
    expect(newChannel('ntfy', []).on).toBe('failure')
    expect(newChannel('healthchecks', []).on).toBe('always')
  })

  it('give a webhook a JSON body that names the outcome', () => {
    const hook = newChannel('webhook', []).webhook!
    expect(hook.headers?.['Content-Type']).toBe('application/json')
    expect(hook.body).toContain('%%title%%')
    expect(hook.body).toContain('%%ok%%')
  })

  it('send only while switched on, and a check only while its when is not never', () => {
    expect(sends({ ...newChannel('slack', []), enabled: false })).toBe(false)
    expect(sends({ ...newChannel('slack', []), on: 'never' })).toBe(false)
    expect(sends({ ...newChannel('healthchecks', []), on: 'never' })).toBe(false)
    expect(sends(newChannel('healthchecks', []))).toBe(true)
  })
})
