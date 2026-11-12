// @vitest-environment jsdom
// The Pairing tile walks one instance through making the twelve words and
// another through entering them, then lists who waits for approval.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConnectInfo, RelayConfig } from '../../lib/api'
import type { FortressInfo } from '../../lib/fortress'

const connect = vi.fn()
const relay = vi.fn()
const makePhrase = vi.fn()
const joinGroup = vi.fn()
const approveMember = vi.fn()
const revealPhrase = vi.fn()
const fortress = vi.fn()
const removeMember = vi.fn()
let heard: ((ev: { job: string; phase: string }) => void) | null = null
vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  api: {
    connect: () => connect(),
    relay: () => relay(),
    makePhrase: () => makePhrase(),
    joinGroup: (phrase: string) => joinGroup(phrase),
    approveMember: (id: string) => approveMember(id),
    revealPhrase: (password: string) => revealPhrase(password),
    fortress: () => fortress(),
    leaveGroup: vi.fn(),
    refuseMember: vi.fn(),
    removeMember: (id: string) => removeMember(id),
    renameInstance: vi.fn(),
    saveRelay: vi.fn(),
    instances: () => Promise.resolve([]),
    watch: (onEvent: (ev: { job: string; phase: string }) => void) => {
      heard = onEvent
      return () => {
        heard = null
      }
    },
  },
}))

import { ApiError } from '../../lib/api'
import { en } from '../../lib/i18n'
import { PairingPage } from './PairingPage'

// jsdom has no ResizeObserver, which the relay selector measures its room with.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const WORDS = 'orbit wagon lemon crisp absent tunnel galaxy harbor pencil ribbon velvet yellow'

const outside: ConnectInfo = {
  active: false,
  connected: false,
  passwordSet: true,
  relayMode: 'project',
  relayUrl: 'wss://parleyport.halleluja.design/relay/connect',
  projectRelayUrl: 'wss://parleyport.halleluja.design/relay/connect',
  name: 'nas',
  deployment: 'container',
  members: [],
  away: [],
  joinedAgo: 0,
  memberSeen: false,
  pending: [],
  awaiting: false,
  behind: [],
  fingerprint: '',
}

const relayConfig: RelayConfig = {
  mode: 'project',
  relayUrl: '',
  projectRelayUrl: 'wss://parleyport.halleluja.design/relay/connect',
  connected: false,
  serve: false,
  serveClients: 0,
  canServe: true,
}

const noFortress: FortressInfo = { joined: false, phrase: false, device: 'nas', defaultDevice: 'nas', passwordSet: true, members: [], permissions: [], removed: [], removedHere: false }

beforeEach(() => {
  for (const fn of [connect, relay, makePhrase, joinGroup, approveMember, revealPhrase, fortress, removeMember]) fn.mockReset()
  relay.mockResolvedValue(relayConfig)
  fortress.mockResolvedValue(noFortress)
})
afterEach(cleanup)

describe('the Pairing tile', () => {
  it('shows the twelve words it made, with the code for a phone', async () => {
    connect.mockResolvedValue(outside)
    makePhrase.mockResolvedValue({
      phrase: WORDS,
      code: WORDS,
      info: { ...outside, active: true, fingerprint: 'aaaa bbbb cccc dddd' },
    })
    render(<PairingPage />)
    fireEvent.click(await screen.findByRole('button', { name: /make a phrase/i }))

    const words = await screen.findByRole('list', { name: 'The twelve words' })
    expect(words.textContent).toContain('orbit')
    expect(words.textContent).toContain('yellow')
    expect(screen.getByText(/scan the code/i)).toBeTruthy()
    expect(screen.getByText('Now, on the other instance')).toBeTruthy()
  })

  it('names a mistyped word before anything is sent, and pairs with twelve good ones', async () => {
    connect.mockResolvedValue(outside)
    joinGroup.mockResolvedValue({ ...outside, active: true })
    render(<PairingPage />)
    fireEvent.click(await screen.findByRole('button', { name: /enter phrase/i }))

    const field = screen.getByRole('textbox', { name: en['pairing.enterLabel'] })
    fireEvent.change(field, { target: { value: 'orbit wagon lemmon ' } })
    expect(screen.getByRole('alert').textContent).toContain('Word 3 ("lemmon")')
    expect((screen.getByRole('button', { name: 'Pair' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(field, { target: { value: WORDS.split(' ').map((w, i) => `${i + 1}. ${w}`).join('\n') } })
    const pairButton = screen.getByRole('button', { name: 'Pair' }) as HTMLButtonElement
    expect(pairButton.disabled).toBe(false)
    fireEvent.click(pairButton)
    await waitFor(() => expect(joinGroup).toHaveBeenCalledWith(WORDS))
  })

  it('says why the engine refused the words', async () => {
    connect.mockResolvedValue(outside)
    joinGroup.mockRejectedValue(new ApiError('seedphrase: checksum', 400, 'checksum'))
    render(<PairingPage />)
    fireEvent.click(await screen.findByRole('button', { name: /enter phrase/i }))
    fireEvent.change(screen.getByRole('textbox', { name: en['pairing.enterLabel'] }), { target: { value: WORDS } })
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/don't fit together/))
  })

  it('asks for the password before it shows the words again', async () => {
    connect.mockResolvedValue({ ...outside, active: true, joinedAgo: 600, memberSeen: true })
    revealPhrase.mockResolvedValue({ phrase: WORDS, code: WORDS })
    render(<PairingPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show phrase' }))
    expect(revealPhrase).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show phrase' }))
    await waitFor(() => expect(revealPhrase).toHaveBeenCalledWith('secret'))
    expect(await screen.findByRole('list', { name: 'The twelve words' })).toBeTruthy()
  })

  it('lists an instance waiting for approval with its key and approves it', async () => {
    connect.mockResolvedValue({
      ...outside,
      active: true,
      joinedAgo: 30,
      members: [{ id: 'b'.repeat(40), name: 'Laptop', deployment: 'desktop', approved: false }],
      pending: [{ id: 'b'.repeat(40), name: 'Laptop', fingerprint: '1a2b 3c4d 5e6f 7a8b' }],
    })
    approveMember.mockResolvedValue(undefined)
    render(<PairingPage />)
    expect(await screen.findByText('Key 1a2b 3c4d 5e6f 7a8b')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(approveMember).toHaveBeenCalledWith('b'.repeat(40)))
  })
  it('lists the devices that did not follow into the fortress by name and kind, and takes one out', async () => {
    connect.mockResolvedValue({
      ...outside,
      active: true,
      memberSeen: true,
      behind: [{ id: 'c'.repeat(40), name: 'Old laptop', deployment: 'desktop' }],
    })
    removeMember.mockResolvedValue(undefined)
    render(<PairingPage />)
    const section = await screen.findByRole('region', { name: en['pairing.behindTitle'] })
    expect(within(section).getByText('Old laptop')).toBeTruthy()
    expect(within(section).getByText(en['instances.kind.desktop'])).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: en['pairing.remove'] }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en['pairing.remove'] }))
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('c'.repeat(40)))
  })

  it('draws the three steps as numbered cards, each with its picture', async () => {
    connect.mockResolvedValue(outside)
    const { container } = render(<PairingPage />)
    const steps = await screen.findByRole('region', { name: en['pairing.howTitle'] })
    expect(within(steps).getAllByRole('heading').map((h) => h.textContent)).toEqual([
      `1${en['pairing.step1Title']}`,
      `2${en['pairing.step2Title']}`,
      `3${en['pairing.step3Title']}`,
    ])
    expect(container.querySelectorAll('svg.al-scene-pic')).toHaveLength(3)
  })

  it('leaves the sidebar switch for Instances to the Look tile', async () => {
    connect.mockResolvedValue(outside)
    render(<PairingPage />)
    await screen.findByRole('button', { name: /make a phrase/i })
    expect(screen.queryByText(en['settings.showInSidebar'])).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('draws the relay route the owner picked, with its picture', async () => {
    connect.mockResolvedValue({ ...outside, active: true, joinedAgo: 600, memberSeen: true })
    relay.mockResolvedValue({ ...relayConfig, connected: true })
    render(<PairingPage />)
    expect(await screen.findByRole('img', { name: en['relay.pic.relay'] })).toBeTruthy()
    expect(screen.getByTestId('relay-state').textContent).toBe(en['relay.connected'])
  })

  it('reads the group again when the event stream says it changed, and not on a timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      connect.mockResolvedValue({ ...outside, active: true, joinedAgo: 600, memberSeen: true })
      render(<PairingPage />)
      await waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
      vi.advanceTimersByTime(60_000)
      expect(connect).toHaveBeenCalledTimes(1)

      heard?.({ job: 'photos', phase: 'finished' })
      expect(connect).toHaveBeenCalledTimes(1)
      heard?.({ job: '', phase: 'group' })
      await waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers to join a fortress below the pairing', async () => {
    connect.mockResolvedValue(outside)
    render(<PairingPage />)
    expect(await screen.findByText('Not in a fortress yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: /make a phrase/i })).toBeTruthy()
  })

  it('leaves the phrase to the fortress once this instance is in one', async () => {
    connect.mockResolvedValue({ ...outside, active: true, joinedAgo: 600, memberSeen: true })
    fortress.mockResolvedValue({ ...noFortress, joined: true, phrase: true })
    render(<PairingPage />)
    expect(await screen.findByText(en['fortress.title'])).toBeTruthy()
    expect(screen.queryByText(en['pairing.searchingLead'])).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Show phrase' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: en['pairing.leave'] })).toBeNull()
  })

  it('reads the fortress again when the window gets the focus back', async () => {
    connect.mockResolvedValue(outside)
    render(<PairingPage />)
    await waitFor(() => expect(fortress).toHaveBeenCalledTimes(1))
    fireEvent.focus(window)
    await waitFor(() => expect(fortress).toHaveBeenCalledTimes(2))
  })
})
