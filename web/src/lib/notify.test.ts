import { describe, expect, it } from 'vitest'

import { channelOn, notifyWhen } from './notify'

describe('the notification settings', () => {
  it('read an older file the way the engine does', () => {
    expect(notifyWhen({})).toBe('failure')
    expect(notifyWhen({ onSuccess: true })).toBe('always')
    expect(notifyWhen({ on: 'failure', onSuccess: true })).toBe('failure')
    expect(channelOn({ webhook: 'https://hooks.example/x' }, 'webhook')).toBe(true)
    expect(channelOn({ matrix: { homeserver: 'https://m.example', room: '!r:m', token: '********' } }, 'matrix')).toBe(true)
  })

  it('keep a channel off that was switched off, however filled in it is', () => {
    const n = {
      webhook: 'https://hooks.example/x',
      webhookEnabled: false,
      smtp: { enabled: false, host: 'm', from: 'a@b', to: 'c@d' },
      healthchecks: { enabled: false, url: 'https://hc-ping.com/x' },
    }
    expect(channelOn(n, 'webhook')).toBe(false)
    expect(channelOn(n, 'smtp')).toBe(false)
    expect(channelOn(n, 'healthchecks')).toBe(false)
  })

  it('show a channel nobody filled in as off', () => {
    expect(channelOn({}, 'apprise')).toBe(false)
    expect(channelOn({ smtp: { host: 'm', from: 'a@b' } }, 'smtp')).toBe(false)
  })
})
