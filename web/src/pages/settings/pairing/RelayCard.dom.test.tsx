// @vitest-environment jsdom
// The relay card offers four routes on one row, and each says what it is,
// what it needs and how a message travels on it.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConnectInfo, RelayConfig } from '../../../lib/api'

const saveRelay = vi.fn()
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof import('../../../lib/api')>()),
  api: { saveRelay: (change: unknown) => saveRelay(change) },
}))

import { en } from '../../../lib/i18n'
import { RelayCard } from './RelayCard'

// jsdom has no ResizeObserver, which the relay selector measures its room with.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const PROJECT = 'wss://parleyport.halleluja.design/relay/connect'

const group: ConnectInfo = {
  active: true,
  connected: false,
  passwordSet: true,
  relayMode: 'project',
  relayUrl: PROJECT,
  projectRelayUrl: PROJECT,
  name: 'nas',
  deployment: 'container',
  members: [],
  away: [],
  joinedAgo: 600,
  memberSeen: true,
  pending: [],
  awaiting: false,
  behind: [],
  fingerprint: 'aaaa bbbb cccc dddd',
}

const relay: RelayConfig = {
  mode: 'project',
  relayUrl: '',
  projectRelayUrl: PROJECT,
  connected: true,
  serve: false,
  serveClients: 0,
  canServe: true,
}

function card(r: Partial<RelayConfig> = {}, g: Partial<ConnectInfo> = {}) {
  const onRelay = vi.fn()
  render(<RelayCard group={{ ...group, ...g }} relay={{ ...relay, ...r }} stage="paired" hueIndex={6} onRelay={onRelay} onRefresh={() => {}} />)
  return onRelay
}

function text() {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  saveRelay.mockReset()
  saveRelay.mockImplementation((change: Partial<RelayConfig>) => Promise.resolve({ ...relay, ...change }))
})
afterEach(cleanup)

describe('the relay card', () => {
  it('offers the four routes in one row, as BombVault does', () => {
    card()
    const picker = screen.getByRole('tablist', { name: en['relay.title'] })
    expect(within(picker).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      en['relay.project'],
      en['relay.own'],
      en['relay.instanceName'],
      en['relay.off'],
    ])
    expect(picker.className).toContain('flex-nowrap')
    expect(picker.className).not.toContain('flex-wrap')
  })

  it('says what the project relay is and that it needs nothing', () => {
    card()
    expect(text()).toContain(en['relay.projectSentence'].replace('{host}', 'parleyport.halleluja.design'))
    expect(text()).toContain(en['relay.projectNeed'])
    expect(screen.getByRole('img', { name: en['relay.pic.relay'] })).toBeTruthy()
  })

  it('asks for the address of an own relay', () => {
    card({ mode: 'own', relayUrl: 'wss://relay.example.org' })
    expect(text()).toContain(en['relay.ownSentence'])
    expect(text()).toContain(en['relay.ownNeed'])
    expect((screen.getByRole('textbox', { name: en['relay.address'] }) as HTMLInputElement).value).toBe('wss://relay.example.org')
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('lets this instance serve the relay of its group and counts who is on it', () => {
    card({ mode: 'own', relayUrl: 'https://nas.example.org', serve: true, serveClients: 2 })
    expect(screen.getByRole('tab', { name: en['relay.instanceName'] }).getAttribute('aria-selected')).toBe('true')
    expect(text()).toContain(en['relay.instanceSub'])
    expect(text()).toContain(en['relay.instanceNeed'])
    expect(text()).toContain(en['relay.instanceCert'])
    expect((screen.getByRole('switch', { name: en['relay.serve'] }) as HTMLElement).getAttribute('aria-checked')).toBe('true')
    expect(text()).toContain(en['relay.serveClients'].replace('{count}', '2'))
    expect(screen.getByRole('img', { name: en['relay.pic.instance'] })).toBeTruthy()
  })

  it('reads an address at the path an instance serves under as an instance', () => {
    card({ mode: 'own', relayUrl: 'https://nas.example.org/relay/connect' })
    expect(screen.getByRole('tab', { name: en['relay.instanceName'] }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('switch', { name: en['relay.serve'] }) as HTMLElement).getAttribute('aria-checked')).toBe('false')
    expect(text()).not.toContain(en['relay.serveClients'].replace('{count}', '0'))
  })

  it('leaves the switch out where nobody reaches this instance', () => {
    card({ mode: 'own', relayUrl: 'https://nas.example.org/relay/connect', canServe: false }, { deployment: 'desktop' })
    expect(text()).toContain(en['relay.instanceSub'])
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByRole('textbox', { name: en['relay.address'] })).toBeTruthy()
  })

  it('stores an instance as an own relay and the switch on its own', async () => {
    const onRelay = card()
    fireEvent.click(screen.getByRole('tab', { name: en['relay.instanceName'] }))
    expect(saveRelay).toHaveBeenCalledWith({ mode: 'own' })
    await vi.waitFor(() => expect(onRelay).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('switch', { name: en['relay.serve'] }))
    expect(saveRelay).toHaveBeenLastCalledWith({ serve: true })
  })

  it('switches serving off when another route is picked', () => {
    card({ mode: 'own', relayUrl: 'https://nas.example.org', serve: true })
    fireEvent.click(screen.getByRole('tab', { name: en['relay.project'] }))
    expect(saveRelay).toHaveBeenCalledWith({ mode: 'project', serve: false })
  })

  it('warns that an address without TLS carries the relay key in the clear', () => {
    card({ mode: 'own', relayUrl: 'http://192.168.1.20:8420/relay/connect' })
    expect(text()).toContain(en['relay.plaintextWarning'])
  })

  it('lists what to check while an instance relay cannot be reached', () => {
    card({ mode: 'own', relayUrl: 'https://nas.example.org/relay/connect', connected: false })
    const check = screen.getByTestId('relay-check')
    expect(check.textContent).toContain(en['pairing.relayCheckOwn'])
    expect(screen.getByTestId('relay-state').textContent).toBe(en['relay.notConnected'])
  })

  it('says only that there is no relay when none is chosen', () => {
    card({ mode: 'off' })
    expect(text()).toContain(en['relay.offSentence'])
    expect(text()).toContain(en['relay.offNeed'])
    expect(screen.getByRole('img', { name: en['relay.pic.off'] })).toBeTruthy()
    expect(screen.queryByTestId('relay-check')).toBeNull()
  })
})
