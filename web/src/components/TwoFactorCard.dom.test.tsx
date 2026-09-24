// @vitest-environment jsdom
// The failures worth guarding in the second factor are the ones that lock the
// owner out: a half-finished setup must never look armed, the recovery codes
// are shown once and must stay until acknowledged, and turning the factor off
// asks for a live code.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const totpSetup = vi.fn()
const totpConfirm = vi.fn()
const totpDisable = vi.fn()
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    totpSetup: () => totpSetup(),
    totpConfirm: (c: string) => totpConfirm(c),
    totpDisable: (c: string) => totpDisable(c),
  },
}))

import { ApiError } from '../lib/api'
import { TwoFactorCard } from './TwoFactorCard'

const URI = 'otpauth://totp/ArrowLoop:tower?secret=GEZDGNBVGY3TQOJQ&issuer=ArrowLoop'

beforeEach(() => {
  totpSetup.mockReset()
  totpConfirm.mockReset()
  totpDisable.mockReset()
})
afterEach(cleanup)

function click(name: RegExp) {
  return act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

function codeBox(): HTMLInputElement | null {
  return document.querySelector('input[autocomplete="one-time-code"]')
}

async function startSetup() {
  totpSetup.mockResolvedValue({ secret: 'GEZDGNBVGY3TQOJQ', uri: URI }) // RFC 6238 test vector gitleaks:allow
  await click(/set up/i)
  await waitFor(() => expect(screen.getByText('GEZDGNBVGY3TQOJQ')).toBeTruthy())
}

describe('TwoFactorCard', () => {
  it('says nothing can be set up before a password exists', () => {
    render(<TwoFactorCard passwordSet={false} enabled={false} onChanged={vi.fn()} />)
    expect(screen.getByText(/set a login password first/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /set up/i })).toBeNull()
  })

  it('shows the QR code and the typed-out secret after setup', async () => {
    render(<TwoFactorCard passwordSet enabled={false} onChanged={vi.fn()} />)
    await startSetup()
    // The QR code for a phone that can scan, the secret for one that cannot.
    expect(document.querySelector('svg[role=img]')).toBeTruthy()
  })

  it('does not claim the factor is on while the setup is unfinished', async () => {
    render(<TwoFactorCard passwordSet enabled={false} onChanged={vi.fn()} />)
    await startSetup()
    expect(screen.getByText(/^Off\./)).toBeTruthy()
  })

  it('shows the recovery codes once the code is accepted, and keeps them on screen', async () => {
    totpConfirm.mockResolvedValue({ recoveryCodes: ['abcde-fghij', 'klmno-pqrst'] })
    const onChanged = vi.fn()
    render(<TwoFactorCard passwordSet enabled={false} onChanged={onChanged} />)
    await startSetup()

    fireEvent.change(codeBox()!, { target: { value: '123456' } })
    await click(/^confirm$/i)

    await waitFor(() => expect(screen.getByText('abcde-fghij')).toBeTruthy())
    expect(screen.getByText('klmno-pqrst')).toBeTruthy()
    expect(totpConfirm).toHaveBeenCalledWith('123456')
    expect(onChanged).toHaveBeenCalled()
    // Stored hashed, so this is the only chance to see them.
    expect(screen.getByRole('button', { name: /written them down/i })).toBeTruthy()
  })

  it('refuses to confirm with an empty code', async () => {
    render(<TwoFactorCard passwordSet enabled={false} onChanged={vi.fn()} />)
    await startSetup()
    const confirm = screen.getByRole('button', { name: /^confirm$/i }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(totpConfirm).not.toHaveBeenCalled()
  })

  it('says a refused code is not valid', async () => {
    totpConfirm.mockRejectedValue(new ApiError('that code is not valid', 400))
    render(<TwoFactorCard passwordSet enabled={false} onChanged={vi.fn()} />)
    await startSetup()
    fireEvent.change(codeBox()!, { target: { value: '000000' } })
    await click(/^confirm$/i)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not valid/i))
  })

  it('asks for a live code before turning the factor off', async () => {
    totpDisable.mockResolvedValue({})
    render(<TwoFactorCard passwordSet enabled recoveryLeft={6} onChanged={vi.fn()} />)
    expect(screen.getByText(/recovery codes left: 6/i)).toBeTruthy()

    // The first press only opens the code field; nothing is sent yet.
    await click(/turn off/i)
    await waitFor(() => expect(codeBox()).not.toBeNull())
    expect(totpDisable).not.toHaveBeenCalled()

    fireEvent.change(codeBox()!, { target: { value: '654321' } })
    await click(/turn off/i)
    await waitFor(() => expect(totpDisable).toHaveBeenCalledWith('654321'))
  })

  it("reports the server's own refusal of a setup", async () => {
    totpSetup.mockRejectedValue(new ApiError('two-factor authentication is already on', 409))
    render(<TwoFactorCard passwordSet enabled={false} onChanged={vi.fn()} />)
    await click(/set up/i)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('already on'))
  })
})
