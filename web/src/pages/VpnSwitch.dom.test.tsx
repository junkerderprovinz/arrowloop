// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let offered = true
let provider = 'custom'

vi.mock('../lib/api', async (actual) => ({
  ...(await actual<typeof import('../lib/api')>()),
  api: {
    capabilities: () => Promise.resolve({ window: false, vpn: offered, version: 'test' }),
    vpn: () => Promise.resolve({ provider, status: 'down', jobs: [], providers: [] }),
  },
}))

const { VpnSwitch } = await import('./Editor')

afterEach(() => {
  cleanup()
  offered = true
  provider = 'custom'
})

function Job({ start = false }: { start?: boolean }) {
  const [on, setOn] = useState(start)
  return (
    <>
      <VpnSwitch on={on} onChange={setOn} />
      <output data-testid="vpn">{String(on)}</output>
    </>
  )
}

describe('the job switch Through the VPN', () => {
  it('switches the job onto the VPN', async () => {
    render(<Job />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Through the VPN' }))
    expect(screen.getByTestId('vpn').textContent).toBe('true')
  })

  it('says the runs fail while no VPN is set up', async () => {
    provider = ''
    render(<Job start />)
    expect(await screen.findByText(/No VPN is set up yet/)).toBeTruthy()
  })

  it('is left out on an engine without a VPN', async () => {
    offered = false
    render(<Job />)
    await waitFor(() => expect(screen.queryByRole('switch')).toBeNull())
  })

  it('stays, so it can be switched off, on a job switched on where there is no VPN', async () => {
    offered = false
    render(<Job start />)
    expect(await screen.findByText(/no built-in VPN on this device/)).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Through the VPN' }))
    expect(screen.getByTestId('vpn').textContent).toBe('false')
  })
})
