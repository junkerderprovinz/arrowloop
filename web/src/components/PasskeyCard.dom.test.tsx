// @vitest-environment jsdom
// Most installs are opened on an IP address, where WebAuthn cannot work, so
// the case this card meets most often is explaining why there is nothing to
// click.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const passkeys = vi.fn()
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    passkeys: () => passkeys(),
    registerPasskey: vi.fn(),
    deletePasskey: vi.fn(),
  },
  passkeysAvailableInBrowser: () => true,
}))

import { PasskeyCard } from './PasskeyCard'

beforeEach(() => passkeys.mockReset())
afterEach(cleanup)

describe('PasskeyCard', () => {
  it('says why, instead of offering a button that cannot work', async () => {
    passkeys.mockResolvedValue({
      supported: false,
      // The server's reason is English; the card shows its own translated text.
      reason: 'ZZZ-SERVER-SENTENCE-ZZZ',
      rpId: '',
      total: 0,
      here: 0,
      passkeys: [],
    })
    render(<PasskeyCard passwordSet />)

    await waitFor(() => expect(screen.getByText(/reverse proxy/i)).toBeTruthy())
    expect(screen.getByText(/host name/i)).toBeTruthy()
    expect(screen.queryByText(/ZZZ-SERVER-SENTENCE-ZZZ/)).toBeNull()
    expect(screen.queryByRole('button', { name: /set up/i })).toBeNull()
  })

  it('offers the button once the address can carry one', async () => {
    passkeys.mockResolvedValue({ supported: true, rpId: 'arrowloop.example.com', total: 0, here: 0, passkeys: [] })
    render(<PasskeyCard passwordSet />)
    await waitFor(() => expect(screen.getByRole('button', { name: /set up/i })).toBeTruthy())
  })

  it('shows a key that belongs to another address, and says so', async () => {
    passkeys.mockResolvedValue({
      supported: true,
      rpId: 'arrowloop.example.com',
      total: 1,
      here: 0,
      passkeys: [
        {
          id: '1',
          name: 'Phone',
          rpId: 'other.example.com',
          usableHere: false,
          backedUp: true,
          createdAt: 0,
          lastUsedAt: 0,
        },
      ],
    })
    render(<PasskeyCard passwordSet />)

    // Hiding it would make a key somebody registered look lost.
    await waitFor(() => expect(screen.getByText('Phone')).toBeTruthy())
    expect(screen.getByText(/other\.example\.com/)).toBeTruthy()
    // The row's remove action is always there, not only on hover.
    expect(screen.getByRole('button', { name: /remove/i })).toBeTruthy()
  })

  it('asks for a password first, because a passkey is never the only way in', async () => {
    passkeys.mockResolvedValue({ supported: true, rpId: 'localhost', total: 0, here: 0, passkeys: [] })
    render(<PasskeyCard passwordSet={false} />)
    await waitFor(() => expect(screen.getByText(/set a login password first/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /set up/i })).toBeNull()
  })
})
