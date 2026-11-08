import { describe, expect, it } from 'vitest'

import { modeOf, relayForm } from './relayForm'

describe('relayForm', () => {
  it('keeps the project relay and no relay as they are stored', () => {
    expect(relayForm({ mode: 'project', relayUrl: 'https://nas.local/relay/connect', serve: true })).toBe('project')
    expect(relayForm({ mode: 'off', relayUrl: '', serve: false })).toBe('off')
  })

  it('reads an own relay as an instance while this one serves it', () => {
    expect(relayForm({ mode: 'own', relayUrl: '', serve: true })).toBe('instance')
    expect(relayForm({ mode: 'own', relayUrl: 'https://arrowloop.example.org', serve: true })).toBe('instance')
  })

  it('reads an address at the path an instance serves under as an instance', () => {
    expect(relayForm({ mode: 'own', relayUrl: 'wss://arrowloop.example.org/relay/connect/', serve: false })).toBe('instance')
  })

  it('leaves a ParleyPort of your own an own relay', () => {
    expect(relayForm({ mode: 'own', relayUrl: 'wss://relay.example.org', serve: false })).toBe('own')
    expect(relayForm({ mode: 'own', relayUrl: 'not an address', serve: false })).toBe('own')
  })

  it('stores an instance as an own relay', () => {
    expect(modeOf('instance')).toBe('own')
    expect(modeOf('project')).toBe('project')
  })
})
