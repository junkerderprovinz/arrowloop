// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VPN_PROVIDERS, type VpnTunnelState } from '../lib/vpn'

let offered = true
let tunnels: VpnTunnelState[] = []

vi.mock('../lib/api', async (actual) => ({
  ...(await actual<typeof import('../lib/api')>()),
  api: {
    capabilities: () => Promise.resolve({ window: false, vpn: offered, version: 'test' }),
    vpn: () =>
      Promise.resolve({ tunnels, providers: VPN_PROVIDERS.map((p) => ({ id: p.id, name: p.name, fields: [...p.fields] })) }),
  },
}))

const { VpnChoice } = await import('./Editor')

const two: VpnTunnelState[] = [
  { id: 'custom', provider: 'custom', place: 'home.example', status: 'down', jobs: [] },
  { id: 'mullvad', provider: 'mullvad', place: 'se-got', status: 'down', jobs: [] },
]

afterEach(() => {
  cleanup()
  offered = true
  tunnels = []
})

function Job({ start = '', network = true }: { start?: string; network?: boolean }) {
  const [vpn, setVpn] = useState(start)
  return (
    <>
      <VpnChoice value={vpn} network={network} onChange={setVpn} />
      <output data-testid="vpn">{vpn}</output>
    </>
  )
}

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('the VPN a job goes through', () => {
  it('is one of the VPNs set up, or none', async () => {
    tunnels = two
    render(<Job />)
    fireEvent.click(await screen.findByRole('button', { name: 'VPN' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['No VPN', 'WireGuard (home.example)', 'Mullvad VPN (se-got)'])
    fireEvent.click(screen.getByRole('option', { name: 'Mullvad VPN (se-got)' }))
    expect(screen.getByTestId('vpn').textContent).toBe('mullvad')
  })

  it('says where to set one up while none is', async () => {
    render(<Job />)
    expect(await screen.findByText(/No VPN is set up yet/)).toBeTruthy()
  })

  it('says the runs fail while the VPN it names is gone', async () => {
    tunnels = two
    render(<Job start="custom-2" />)
    expect(await screen.findByText(/no longer set up/)).toBeTruthy()
  })

  it('is left out on an engine without a VPN', async () => {
    offered = false
    render(<Job />)
    await settle()
    expect(screen.queryByRole('button', { name: 'VPN' })).toBeNull()
  })

  it('is left out on a job between two folders on this device', async () => {
    tunnels = two
    render(<Job network={false} />)
    await settle()
    expect(screen.queryByRole('button', { name: 'VPN' })).toBeNull()
  })

  it('stays, so it can be set to none, on a job between two folders that names a VPN', async () => {
    tunnels = two
    render(<Job start="custom" network={false} />)
    expect(await screen.findByRole('button', { name: 'VPN' })).toBeTruthy()
  })

  it('stays, so it can be set to none, on a job with a VPN where there is none', async () => {
    offered = false
    render(<Job start="custom" />)
    expect(await screen.findByText(/no built-in VPN on this device/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'VPN' }))
    fireEvent.click(screen.getByRole('option', { name: 'No VPN' }))
    await waitFor(() => expect(screen.getByTestId('vpn').textContent).toBe(''))
  })
})
