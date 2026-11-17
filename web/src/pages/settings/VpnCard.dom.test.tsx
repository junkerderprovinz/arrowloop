// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../lib/api'
import { VPN_PROVIDERS, type VpnState } from '../../lib/vpn'

const calls: { save: [string, Record<string, string>][]; forget: string[] } = { save: [], forget: [] }
let state: VpnState
let offered = true
let saveAnswer: () => Promise<VpnState>

function stateWith(provider: string, status: VpnState['status'] = 'down', jobs: string[] = []): VpnState {
  return {
    provider,
    status,
    jobs,
    providers: VPN_PROVIDERS.map((p) => ({ id: p.id, name: p.name, fields: [...p.fields], configured: p.id === provider })),
  }
}

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    capabilities: () => Promise.resolve({ window: false, vpn: offered, version: 'test' }),
    vpn: () => Promise.resolve(state),
    jobs: () => Promise.resolve([{ name: 'photos', vpn: true }, { name: 'music' }]),
    saveVpn: (id: string, fields: Record<string, string>) => {
      calls.save.push([id, fields])
      return saveAnswer()
    },
    forgetVpn: (id: string) => {
      calls.forget.push(id)
      state = stateWith('')
      return Promise.resolve(state)
    },
    testVpn: () => Promise.resolve({ ok: true, state: { ...state, exitIp: '203.0.113.7' } }),
  },
}))

// jsdom has no ResizeObserver, which the tiles use to fit their names.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const { VpnCard } = await import('./VpnCard')

beforeEach(() => {
  calls.save = []
  calls.forget = []
  offered = true
  state = stateWith('')
  saveAnswer = () => Promise.resolve(stateWith('custom'))
})
afterEach(cleanup)

const tiles = (within: HTMLElement) =>
  Array.from(within.querySelectorAll<HTMLButtonElement>('.glim-provider-pick button.glim-readme-btn'))

async function openChooser() {
  render(<VpnCard hueIndex={0} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up a VPN' }))
  return screen.getByRole('dialog')
}

describe('the VPN card', () => {
  it('is left out on an engine without a VPN', async () => {
    offered = false
    const { container } = render(<VpnCard hueIndex={0} />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('says that no VPN is set up yet', async () => {
    render(<VpnCard hueIndex={0} />)
    expect(await screen.findByText(/No VPN is set up/)).toBeTruthy()
  })

  it('shows the provider in use as off at rest and names the jobs that go through it', async () => {
    state = stateWith('mullvad')
    render(<VpnCard hueIndex={0} />)
    expect(await screen.findByText('Off until a job needs it')).toBeTruthy()
    expect(screen.getByText('Mullvad VPN')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('photos')).toBeTruthy())
  })

  it('names the runs a connected tunnel carries', async () => {
    state = stateWith('mullvad', 'connected', ['music', 'photos'])
    render(<VpnCard hueIndex={0} />)
    expect(await screen.findByText('Connected for music, photos')).toBeTruthy()
  })

  it('tells where traffic leaves after a test', async () => {
    state = stateWith('custom')
    render(<VpnCard hueIndex={0} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Traffic leaves at 203.0.113.7.')).toBeTruthy()
  })
})

describe('the VPN chooser', () => {
  it('shows every provider as a tile with its logo, and the own config in a section of its own', async () => {
    const chooser = await openChooser()
    const sections = Array.from(chooser.querySelectorAll('section')).map((s) => ({
      title: s.querySelector('h3')?.textContent,
      count: tiles(s).length,
    }))
    expect(sections).toEqual([
      { title: 'Providers', count: VPN_PROVIDERS.length - 1 },
      { title: 'Your own server', count: 1 },
    ])
    for (const tile of tiles(chooser)) {
      expect(tile.querySelector('.glim-readme-btn-mark img, .glim-readme-btn-mark .glim-mark-rest')).not.toBeNull()
    }
  })

  it("lights a provider's tile in its brand colour", async () => {
    const chooser = await openChooser()
    const item = within(chooser).getByRole('button', { name: 'NordVPN' }).closest('li')!
    expect(item.style.getPropertyValue('--provider-tile')).toBe('#4580ff')
  })

  it('finds a provider by name', async () => {
    const chooser = await openChooser()
    fireEvent.change(within(chooser).getByRole('searchbox'), { target: { value: 'mull' } })
    expect(tiles(chooser).map((b) => b.getAttribute('aria-label'))).toEqual(['Mullvad VPN'])
  })

  it('saves a pasted WireGuard configuration as the own config', async () => {
    const chooser = await openChooser()
    fireEvent.click(within(chooser).getByRole('button', { name: 'Own WireGuard config' }))
    const form = await screen.findByRole('dialog')
    const save = within(form).getByRole('button', { name: 'Save and use' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(within(form).getByRole('textbox', { name: 'WireGuard configuration' }), {
      target: { value: '[Interface]\nPrivateKey = x\n' },
    })
    fireEvent.click(save)
    await waitFor(() => expect(calls.save).toEqual([['custom', { config: '[Interface]\nPrivateKey = x\n' }]]))
    expect(await screen.findByText('Own WireGuard config')).toBeTruthy()
  })

  it('says why a configuration was refused and keeps the form open', async () => {
    saveAnswer = () => Promise.reject(new ApiError('vpn: the interface has no address', 400, 'vpn-config-invalid', { field: 'config' }))
    const chooser = await openChooser()
    fireEvent.click(within(chooser).getByRole('button', { name: 'Own WireGuard config' }))
    const form = await screen.findByRole('dialog')
    fireEvent.change(within(form).getByRole('textbox', { name: 'WireGuard configuration' }), { target: { value: 'nope' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save and use' }))
    expect((await within(form).findByRole('alert')).textContent).toContain('the interface has no address')
  })

  it('asks a provider with a login for its fields and leads back to the tiles', async () => {
    const chooser = await openChooser()
    fireEvent.click(within(chooser).getByRole('button', { name: 'Mullvad VPN' }))
    const form = await screen.findByRole('dialog')
    expect(within(form).getByLabelText('Account number')).toBeTruthy()
    expect(within(form).getByLabelText('Server location')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('searchbox')).toBeTruthy()
  })
})
