// @vitest-environment jsdom
// The login's second factor. The code field appears only when the server asks
// for it, the password is kept for the second step, and the first needCode
// answer is not shown as an error.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const login = vi.fn()
const passkeys = vi.fn()
const loginWithPasskey = vi.fn()
let webauthn = false
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    login: (...a: unknown[]) => login(...a),
    passkeys: () => passkeys(),
    loginWithPasskey: () => loginWithPasskey(),
  },
  passkeysAvailableInBrowser: () => webauthn,
}))

import { ApiError } from '../lib/api'
import { Login } from './Login'

beforeEach(() => {
  login.mockReset()
  passkeys.mockReset()
  loginWithPasskey.mockReset()
  webauthn = false
})
afterEach(cleanup)

const passwordBox = () => document.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!
const codeBox = () => document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')

function typePassword(value: string) {
  fireEvent.change(passwordBox(), { target: { value } })
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
  })
}

describe('Login, the second factor', () => {
  it('shows no code field on an install without a second factor', async () => {
    login.mockResolvedValue({ authenticated: true })
    const onIn = vi.fn()
    render(<Login onIn={onIn} />)
    expect(codeBox()).toBeNull()

    typePassword('hunter2hunter2')
    await submit()
    await waitFor(() => expect(onIn).toHaveBeenCalledTimes(1))
    expect(login).toHaveBeenCalledWith('hunter2hunter2', undefined)
  })

  it('reveals the code field when the server asks, without calling it an error', async () => {
    login.mockResolvedValue({ authenticated: false, needCode: true })
    render(<Login onIn={vi.fn()} />)
    typePassword('hunter2hunter2')
    await submit()
    await waitFor(() => expect(codeBox()).not.toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the password, and sends it again with the code', async () => {
    login.mockResolvedValueOnce({ authenticated: false, needCode: true })
    login.mockResolvedValueOnce({ authenticated: true })
    const onIn = vi.fn()
    render(<Login onIn={onIn} />)

    typePassword('hunter2hunter2')
    await submit()
    await waitFor(() => expect(codeBox()).not.toBeNull())
    expect(passwordBox().value).toBe('hunter2hunter2')

    fireEvent.change(codeBox()!, { target: { value: '123456' } })
    await submit()
    await waitFor(() => expect(onIn).toHaveBeenCalledTimes(1))
    expect(login).toHaveBeenLastCalledWith('hunter2hunter2', '123456')
  })

  it('says so when a code was tried and refused', async () => {
    login.mockResolvedValueOnce({ authenticated: false, needCode: true })
    login.mockRejectedValueOnce(new ApiError('wrong code', 401))
    render(<Login onIn={vi.fn()} />)

    typePassword('hunter2hunter2')
    await submit()
    await waitFor(() => expect(codeBox()).not.toBeNull())
    fireEvent.change(codeBox()!, { target: { value: '000000' } })
    await submit()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not valid/i))
  })

  it('will not send an empty code once one is asked for', async () => {
    login.mockResolvedValue({ authenticated: false, needCode: true })
    render(<Login onIn={vi.fn()} />)
    typePassword('hunter2hunter2')
    await submit()
    await waitFor(() => expect(codeBox()).not.toBeNull())

    const button = screen.getByRole('button', { name: /log in/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(codeBox()!, { target: { value: '123456' } })
    await waitFor(() => expect(button.disabled).toBe(false))
  })

  it('reports a wrong password as a wrong password, not as a missing code', async () => {
    login.mockRejectedValue(new ApiError('wrong password', 401))
    render(<Login onIn={vi.fn()} />)
    typePassword('wrongwrongwrong')
    await submit()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/password is not right/i))
    expect(codeBox()).toBeNull()
  })

  it('says to wait when the address is locked out', async () => {
    login.mockRejectedValue(new ApiError('too many wrong attempts', 429))
    render(<Login onIn={vi.fn()} />)
    typePassword('whatever it is')
    await submit()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/wait a minute/i))
  })
})

describe('Login, the passkey button', () => {
  it('is left out where the browser cannot do passkeys', async () => {
    render(<Login onIn={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull()
    expect(passkeys).not.toHaveBeenCalled()
  })

  it('is left out on an address with no key registered for it', async () => {
    webauthn = true
    passkeys.mockResolvedValue({ supported: true, rpId: 'localhost', total: 1, here: 0 })
    render(<Login onIn={vi.fn()} />)
    await waitFor(() => expect(passkeys).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull()
  })

  it('signs in with a key registered for this address', async () => {
    webauthn = true
    passkeys.mockResolvedValue({ supported: true, rpId: 'localhost', total: 1, here: 1 })
    loginWithPasskey.mockResolvedValue(undefined)
    const onIn = vi.fn()
    render(<Login onIn={onIn} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /passkey/i })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /passkey/i }))
    })
    await waitFor(() => expect(onIn).toHaveBeenCalledTimes(1))
  })
})
