// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../lib/api'
import { VPN_PROVIDERS, type VpnState, type VpnTunnelState } from '../../lib/vpn'

const calls: { add: [string, Record<string, string>][]; save: [string, Record<string, string>][]; forget: string[]; test: string[] } = {
  add: [],
  save: [],
  forget: [],
  test: [],
}
let state: VpnState
let offered = true
let addAnswer: () => Promise<{ id: string; state: VpnState }>
let testAnswer: (id: string) => Promise<{ ok: boolean; reason?: string; state: VpnState }>

const providers = VPN_PROVIDERS.map((p) => ({ id: p.id, name: p.name, fields: [...p.fields] }))

function tunnel(id: string, provider: string, more: Partial<VpnTunnelState> = {}): VpnTunnelState {
  return { id, provider, status: 'down', jobs: [], ...more }
}

function stateWith(...tunnels: VpnTunnelState[]): VpnState {
  return { tunnels, providers }
}

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    capabilities: () => Promise.resolve({ window: false, vpn: offered, version: 'test' }),
    vpn: () => Promise.resolve(state),
    jobs: () =>
      Promise.resolve([
        { name: 'photos', vpn: 'custom' },
        { name: 'music', vpn: 'mullvad' },
        { name: 'notes' },
      ]),
    addVpn: (provider: string, fields: Record<string, string>) => {
      calls.add.push([provider, fields])
      return addAnswer()
    },
    saveVpn: (id: string, fields: Record<string, string>) => {
      calls.save.push([id, fields])
      return Promise.resolve(state)
    },
    forgetVpn: (id: string) => {
      calls.forget.push(id)
      state = stateWith(...state.tunnels.filter((x) => x.id !== id))
      return Promise.resolve(state)
    },
    testVpn: (id: string) => {
      calls.test.push(id)
      return testAnswer(id)
    },
  },
}))

// jsdom has no ResizeObserver, which the tiles use to fit their names.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const { VpnCard } = await import('./VpnCard')

const unresolved = 'WireGuard: vpn: resolve vpn.example.net: lookup vpn.example.net: no such host'

beforeEach(() => {
  calls.add = []
  calls.save = []
  calls.forget = []
  calls.test = []
  offered = true
  state = stateWith()
  addAnswer = () => Promise.resolve({ id: 'custom', state: stateWith(tunnel('custom', 'custom', { place: 'home.example' })) })
  testAnswer = () => Promise.resolve({ ok: true, state: stateWith(tunnel('custom', 'custom', { exitIp: '203.0.113.7' })) })
})
afterEach(cleanup)

const tiles = (within: HTMLElement) =>
  Array.from(within.querySelectorAll<HTMLButtonElement>('.glim-provider-pick button.glim-readme-btn'))

const row = (name: string) => screen.getByRole('region', { name })

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

  it('offers only the way to set one up while none is', async () => {
    render(<VpnCard hueIndex={0} />)
    expect(await screen.findByText(/No VPN is set up/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set up a VPN' })).toBeTruthy()
    for (const name of ['Test', 'Remove', 'Change login']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByText('Jobs that go through it')).toBeNull()
  })

  it('lists every VPN with where it leads, how it stands and the jobs that go through it', async () => {
    state = stateWith(tunnel('custom', 'custom', { place: 'home.example' }), tunnel('mullvad', 'mullvad', { place: 'se-got', status: 'connected', jobs: ['music'] }))
    render(<VpnCard hueIndex={0} />)
    await screen.findByRole('region', { name: 'WireGuard (home.example)' })
    expect(within(row('WireGuard (home.example)')).getByText('Off until a job needs it')).toBeTruthy()
    await waitFor(() => expect(within(row('WireGuard (home.example)')).getByText('photos')).toBeTruthy())
    expect(within(row('Mullvad VPN (se-got)')).getByText('Connected for music')).toBeTruthy()
    expect(within(row('Mullvad VPN (se-got)')).getByText('music', { selector: 'span' })).toBeTruthy()
  })

  it('names each VPN inside its group rather than in a badge on its edge', async () => {
    state = stateWith(tunnel('mullvad', 'mullvad', { place: 'at-vie' }))
    render(<VpnCard hueIndex={0} />)
    const group = await screen.findByRole('region', { name: 'Mullvad VPN (at-vie)' })
    expect(group.querySelector('.glim-panel-heading, .glim-badge--heading, [data-glim="SubCard"]')).toBeNull()
    expect(within(group).getByText('Mullvad VPN (at-vie)')).toBeTruthy()
  })

  it('tests one VPN and tells where its traffic leaves', async () => {
    state = stateWith(tunnel('custom', 'custom'), tunnel('mullvad', 'mullvad'))
    render(<VpnCard hueIndex={0} />)
    await screen.findByRole('region', { name: 'WireGuard' })
    fireEvent.click(within(row('WireGuard')).getByRole('button', { name: 'Test' }))
    expect(await within(row('WireGuard')).findByText('Traffic leaves at 203.0.113.7.')).toBeTruthy()
    expect(calls.test).toEqual(['custom'])
  })

  it('removes one VPN and keeps the others', async () => {
    state = stateWith(tunnel('custom', 'custom'), tunnel('mullvad', 'mullvad'))
    render(<VpnCard hueIndex={0} />)
    await screen.findByRole('region', { name: 'WireGuard' })
    fireEvent.click(within(row('WireGuard')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'WireGuard' })).toBeNull())
    expect(calls.forget).toEqual(['custom'])
    expect(screen.getByRole('region', { name: 'Mullvad VPN' })).toBeTruthy()
  })

  it("changes one VPN's login", async () => {
    state = stateWith(tunnel('mullvad-2', 'mullvad', { place: 'de-fra' }))
    render(<VpnCard hueIndex={0} />)
    fireEvent.click(within(await screen.findByRole('region', { name: 'Mullvad VPN (de-fra)' })).getByRole('button', { name: 'Change login' }))
    const form = await screen.findByRole('dialog')
    expect((within(form).getByLabelText('Server location') as HTMLInputElement).value).toBe('de-fra')
    fireEvent.change(within(form).getByLabelText('Account number'), { target: { value: '1234' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.save).toEqual([['mullvad-2', { accountNumber: '1234' }]]))
  })

  it("says a server name that was not found in the reader's words and keeps the engine's on hover", async () => {
    state = stateWith(tunnel('custom', 'custom', { status: 'failed', error: unresolved, errorCode: 'vpn-name-unresolved' }))
    render(<VpnCard hueIndex={0} />)
    const said = await screen.findByRole('status')
    expect(said.textContent).toMatch(/^The server's name was not found\./)
    expect(said.textContent).not.toContain('vpn: resolve')
    expect(said.getAttribute('data-tip')).toContain(unresolved)
  })

  it("answers a failed test in the reader's words", async () => {
    state = stateWith(tunnel('custom', 'custom'))
    testAnswer = () =>
      Promise.resolve({
        ok: false,
        reason: unresolved,
        state: stateWith(tunnel('custom', 'custom', { status: 'failed', error: unresolved, errorCode: 'vpn-name-unresolved' })),
      })
    render(<VpnCard hueIndex={0} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Test' }))
    const verdict = await screen.findByTestId('vpn-verdict')
    expect(verdict.textContent).toMatch(/^The server's name was not found\./)
    expect(verdict.textContent).not.toContain('vpn: resolve')
    expect(verdict.getAttribute('data-tip')).toContain(unresolved)
  })

  it('says why a test failed once, not again in the status line', async () => {
    state = stateWith(tunnel('custom', 'custom'))
    testAnswer = () =>
      Promise.resolve({
        ok: false,
        reason: unresolved,
        state: stateWith(tunnel('custom', 'custom', { status: 'failed', error: unresolved, errorCode: 'vpn-name-unresolved' })),
      })
    render(<VpnCard hueIndex={0} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Test' }))
    await screen.findByTestId('vpn-verdict')
    expect(screen.getAllByText(/^The server's name was not found\./)).toHaveLength(1)
  })
})

describe('the VPN chooser', () => {
  it('shows every provider as a tile with its logo, and WireGuard in a section of its own', async () => {
    const chooser = await openChooser()
    const sections = Array.from(chooser.querySelectorAll('section')).map((s) => ({
      title: s.querySelector('h3')?.textContent,
      count: tiles(s).length,
    }))
    expect(sections).toEqual([
      { title: 'Providers', count: VPN_PROVIDERS.length - 1 },
      { title: 'Your own server', count: 1 },
    ])
    expect(within(chooser).getByRole('button', { name: 'WireGuard' })).toBeTruthy()
    for (const tile of tiles(chooser)) {
      expect(tile.querySelector('.glim-readme-btn-mark img, .glim-readme-btn-mark .glim-mark-rest')).not.toBeNull()
    }
  })

  it('opens in the picker window the channels and targets use', async () => {
    const chooser = await openChooser()
    expect(chooser.getAttribute('data-glim')).toBe('PickerWindow')
  })

  it('empties the search on Escape before it lets the window close', async () => {
    const chooser = await openChooser()
    const search = within(chooser).getByRole('searchbox') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'mull' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search.value).toBe('')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('draws a logo once at rest and once lit, with no class that keeps the rest one showing', async () => {
    const chooser = await openChooser()
    const mark = within(chooser).getByRole('button', { name: 'NordVPN' }).querySelector('.glim-brand-svg')!
    expect(mark.querySelectorAll(':scope > .glim-mark-rest')).toHaveLength(1)
    expect(mark.querySelectorAll(':scope > .glim-mark-hover')).toHaveLength(1)
    expect(mark.querySelector('.block')).toBeNull()
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

  it('adds a pasted WireGuard configuration as a VPN of its own', async () => {
    state = stateWith(tunnel('mullvad', 'mullvad'))
    const chooser = await openChooser()
    fireEvent.click(within(chooser).getByRole('button', { name: 'WireGuard' }))
    const form = await screen.findByRole('dialog')
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(within(form).getByRole('textbox', { name: 'WireGuard configuration' }), {
      target: { value: '[Interface]\nPrivateKey = x\n' },
    })
    fireEvent.click(save)
    await waitFor(() => expect(calls.add).toEqual([['custom', { config: '[Interface]\nPrivateKey = x\n' }]]))
    expect(await screen.findByRole('region', { name: 'WireGuard (home.example)' })).toBeTruthy()
  })

  it("says in the reader's words why a configuration was refused and keeps the form open", async () => {
    addAnswer = () => Promise.reject(new ApiError('vpn: the interface has no address', 400, 'vpn-config-invalid', { field: 'config' }))
    const chooser = await openChooser()
    fireEvent.click(within(chooser).getByRole('button', { name: 'WireGuard' }))
    const form = await screen.findByRole('dialog')
    fireEvent.change(within(form).getByRole('textbox', { name: 'WireGuard configuration' }), { target: { value: 'nope' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    const alert = await within(form).findByRole('alert')
    expect(alert.textContent).toBe('This is not a WireGuard configuration ArrowLoop can use.')
    expect(alert.getAttribute('data-tip')).toContain('the interface has no address')
  })

  it('names the line of a configuration that does not fit', async () => {
    addAnswer = () =>
      Promise.reject(
        new ApiError('vpn: line 4: not key = value', 400, 'vpn-config-invalid', { field: 'config', line: '4', text: 'Adress 10.0.0.2/32' }),
      )
    const chooser = await openChooser()
    fireEvent.click(within(chooser).getByRole('button', { name: 'WireGuard' }))
    const form = await screen.findByRole('dialog')
    fireEvent.change(within(form).getByRole('textbox', { name: 'WireGuard configuration' }), { target: { value: 'nope' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    const alert = await within(form).findByRole('alert')
    expect(alert.textContent).toBe('Line 4 of the configuration does not fit: Adress 10.0.0.2/32')
    expect(alert.getAttribute('data-tip')).toContain('not key = value')
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
