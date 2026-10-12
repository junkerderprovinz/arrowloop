// @vitest-environment jsdom
// Resetting a forgotten password with the code from the log: the button shows
// only where a reset is possible, the form only once a code is in the log, the
// code is never shown here, and the page after it says what went.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resetBegin = vi.fn()
const resetFinish = vi.fn()
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    passkeys: () => Promise.resolve({ supported: false, here: 0 }),
    resetBegin: () => resetBegin(),
    resetFinish: (...a: unknown[]) => resetFinish(...a),
  },
  passkeysAvailableInBrowser: () => false,
}))

import { ApiError } from '../lib/api'
import { Login } from './Login'

beforeEach(() => {
  resetBegin.mockReset()
  resetFinish.mockReset()
  resetBegin.mockResolvedValue({ minutes: 10, minPasswordLen: 12 })
})
afterEach(cleanup)

async function click(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

const codeBox = () => document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')
const newBoxes = () => [...document.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]')]

function type(box: HTMLInputElement, value: string) {
  fireEvent.change(box, { target: { value } })
}

async function openReset() {
  render(<Login onIn={vi.fn()} canReset />)
  await click(/forgot password/i)
}

describe('Login, a forgotten password', () => {
  it('offers no reset where the password comes from elsewhere', () => {
    render(<Login onIn={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /forgot password/i })).toBeNull()
  })

  it('puts a quiet full-width Forgot password? at the foot of the form', () => {
    render(<Login onIn={vi.fn()} canReset />)
    const buttons = [...document.querySelectorAll('form button:not([aria-pressed])')]
    const forgot = screen.getByRole('button', { name: /forgot password/i })
    expect(buttons[buttons.length - 1]).toBe(forgot)
    expect(forgot.className).toContain('w-full')
    expect(forgot.className).not.toContain('bg-accent')
    expect(screen.getByRole('button', { name: /log in/i }).className).toContain('w-full')
  })

  it('shows the form only once the code is in the log', async () => {
    let written: (v: unknown) => void = () => undefined
    resetBegin.mockReturnValue(new Promise((done) => (written = done)))
    await openReset()
    expect(codeBox()).toBeNull()
    await act(async () => written({ minutes: 10, minPasswordLen: 12 }))
    expect(resetBegin).toHaveBeenCalledTimes(1)
    expect(codeBox()).toBeTruthy()
  })

  it('stays on the sign-in form when no code could be written', async () => {
    resetBegin.mockRejectedValue(new ApiError('no password is set', 409))
    await openReset()
    expect(codeBox()).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('takes the code in capitals, without spellcheck, and lets the browser fill it in', async () => {
    await openReset()
    const box = codeBox()!
    expect(box.placeholder).toBe('XXXX-XXXX-XXXX')
    expect(box.getAttribute('spellcheck')).toBe('false')
    expect(box.getAttribute('autocapitalize')).toBe('characters')
    expect(box.className).toContain('uppercase')
    expect(screen.getByText('Code from the container log')).toBeTruthy()
  })

  it('says in the code tip where the log is, how long the code lasts and what goes', async () => {
    resetBegin.mockResolvedValue({ minutes: 10, minPasswordLen: 12 })
    await openReset()
    const tip = screen.getByLabelText(/container log/i, { selector: 'span' }).getAttribute('aria-label')!
    for (const part of [/Unraid/, /10 minutes/, /Dozzle/, /two-factor/i, /passkey/i, /session/i]) {
      expect(tip).toMatch(part)
    }
  })

  it('catches a short password and a mismatch before sending anything', async () => {
    resetBegin.mockResolvedValue({ minutes: 10, minPasswordLen: 16 })
    await openReset()
    type(codeBox()!, 'ABCD-EFGH-JKLM')
    const [password, confirm] = newBoxes()
    type(password!, 'fourteen chars')
    type(confirm!, 'fourteen chars')
    await click(/set password/i)
    expect(screen.getByRole('alert').textContent).toMatch(/16/)

    type(password!, 'a brand new passphrase')
    type(confirm!, 'a brand new passphrasf')
    await click(/set password/i)
    expect(screen.getByRole('alert').textContent).toBe('Passwords do not match')
    expect(resetFinish).not.toHaveBeenCalled()
  })

  it('answers a refused code with the one sentence and asks for a new code', async () => {
    resetFinish.mockRejectedValue(new ApiError('that code is wrong or has expired', 400))
    await openReset()
    type(codeBox()!, 'nope')
    for (const box of newBoxes()) type(box, 'a brand new passphrase')
    await click(/set password/i)
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'That code is wrong or has expired. If it expired, the log now shows a new one.',
      ),
    )
    expect(resetBegin).toHaveBeenCalledTimes(2)
  })

  it('lists what went and where to add the passkeys again', async () => {
    resetFinish.mockResolvedValue({ removed: { secondFactor: true, passkeys: 2 } })
    const onIn = vi.fn()
    render(<Login onIn={onIn} canReset />)
    await click(/forgot password/i)
    type(codeBox()!, 'abcd-efgh-jklm')
    for (const box of newBoxes()) type(box, 'a brand new passphrase')
    await click(/set password/i)
    expect(resetFinish).toHaveBeenCalledWith('abcd-efgh-jklm', 'a brand new passphrase')

    expect(await screen.findByText('Your new password is set')).toBeTruthy()
    expect(screen.getByText('The reset also removed every other way in:')).toBeTruthy()
    expect(screen.getByText('Every other session has ended')).toBeTruthy()
    expect(screen.getByText('Two-factor authentication is off')).toBeTruthy()
    expect(screen.getByText('Passkeys removed: 2')).toBeTruthy()
    expect(screen.getByText(/Settings, Security/)).toBeTruthy()
    await click(/done/i)
    expect(onIn).toHaveBeenCalledTimes(1)
  })

  it('names only what was there', async () => {
    resetFinish.mockResolvedValue({ removed: { secondFactor: false, passkeys: 0 } })
    await openReset()
    type(codeBox()!, 'ABCDEFGHJKLM')
    for (const box of newBoxes()) type(box, 'a brand new passphrase')
    await click(/set password/i)
    expect(await screen.findByText('Every other session has ended')).toBeTruthy()
    expect(screen.queryByText('Two-factor authentication is off')).toBeNull()
    expect(screen.queryByText(/Passkeys removed/)).toBeNull()
    expect(screen.queryByText(/Settings, Security/)).toBeNull()
  })

  it('goes back to the sign-in form', async () => {
    await openReset()
    await click(/back/i)
    expect(codeBox()).toBeNull()
    expect(screen.getByRole('button', { name: /log in/i })).toBeTruthy()
  })
})
