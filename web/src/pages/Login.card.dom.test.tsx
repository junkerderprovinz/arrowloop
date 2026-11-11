// @vitest-environment jsdom
// The sign-in page as GlimStone's sign-in card draws it: the logo and the name
// in the head, the focus in the first field, Sign in waiting for a password, a
// refusal that shakes the button that sent it, and the system's look followed
// before anybody has signed in.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const login = vi.fn()
const resetBegin = vi.fn()
const resetFinish = vi.fn()
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    login: (...a: unknown[]) => login(...a),
    passkeys: () => Promise.resolve({ supported: false, here: 0 }),
    resetBegin: () => resetBegin(),
    resetFinish: (...a: unknown[]) => resetFinish(...a),
  },
  passkeysAvailableInBrowser: () => false,
}))

import { ApiError } from '../lib/api'
import { Login } from './Login'

beforeEach(() => {
  login.mockReset()
  resetBegin.mockReset()
  resetFinish.mockReset()
  resetBegin.mockResolvedValue({ minutes: 10, minPasswordLen: 12 })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const passwordBox = () => document.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!
const codeBox = () => document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')
const signIn = () => screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement

async function click(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button)
  })
}

describe('Login, the card', () => {
  it('names the app under its logo and nothing over the card', () => {
    render(<Login onIn={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'ArrowLoop' })).toBeTruthy()
    expect(document.querySelector('.glim-signin-logo svg')).toBeTruthy()
    expect(screen.queryByText('This interface is protected')).toBeNull()
  })

  it('writes Password into its field and keeps it as the field name', () => {
    render(<Login onIn={vi.fn()} />)
    expect(passwordBox().placeholder).toBe('Password')
    expect(screen.getByLabelText('Password', { selector: 'input' })).toBe(passwordBox())
    expect(document.querySelector(`label[for="${passwordBox().id}"]`)!.className).toBe('glim-sr-only')
  })

  it('opens with the focus in the password', () => {
    render(<Login onIn={vi.fn()} />)
    expect(document.activeElement).toBe(passwordBox())
  })

  it('waits for a password before Sign in can be pressed', () => {
    render(<Login onIn={vi.fn()} />)
    expect(signIn().disabled).toBe(true)
    fireEvent.change(passwordBox(), { target: { value: 'x' } })
    expect(signIn().disabled).toBe(false)
  })

  it('shakes Sign in once and selects the password after a wrong one', async () => {
    login.mockRejectedValue(new ApiError('wrong password', 401))
    render(<Login onIn={vi.fn()} />)
    fireEvent.change(passwordBox(), { target: { value: 'wrongwrongwrong' } })
    await click(signIn())
    await waitFor(() => expect(signIn().classList.contains('glim-shake')).toBe(true))
    expect(document.activeElement).toBe(passwordBox())
    expect(passwordBox().selectionStart).toBe(0)
    expect(passwordBox().selectionEnd).toBe('wrongwrongwrong'.length)
  })

  it('moves the focus to the code once the server asks for one', async () => {
    login.mockResolvedValue({ authenticated: false, needCode: true })
    render(<Login onIn={vi.fn()} />)
    fireEvent.change(passwordBox(), { target: { value: 'hunter2hunter2' } })
    await click(signIn())
    await waitFor(() => expect(document.activeElement).toBe(codeBox()))
  })

  it('shakes Sign in and empties the code after a wrong code', async () => {
    login.mockResolvedValueOnce({ authenticated: false, needCode: true })
    login.mockRejectedValueOnce(new ApiError('wrong code', 401))
    render(<Login onIn={vi.fn()} />)
    fireEvent.change(passwordBox(), { target: { value: 'hunter2hunter2' } })
    await click(signIn())
    await waitFor(() => expect(codeBox()).not.toBeNull())
    fireEvent.change(codeBox()!, { target: { value: '000000' } })
    await click(signIn())
    await waitFor(() => expect(signIn().classList.contains('glim-shake')).toBe(true))
    expect(codeBox()!.value).toBe('')
  })

  it('puts Back in the place of Forgot password? while it asks for the code', async () => {
    login.mockResolvedValue({ authenticated: false, needCode: true })
    render(<Login onIn={vi.fn()} canReset />)
    fireEvent.change(passwordBox(), { target: { value: 'hunter2hunter2' } })
    await click(signIn())
    await waitFor(() => expect(codeBox()).not.toBeNull())
    expect(screen.queryByRole('button', { name: /forgot password/i })).toBeNull()
    await click(screen.getByRole('button', { name: /^back$/i }))
    expect(codeBox()).toBeNull()
    expect(passwordBox().value).toBe('hunter2hunter2')
  })

  it('shakes Set password when the code from the log is refused', async () => {
    resetFinish.mockRejectedValue(new ApiError('that code is wrong or has expired', 400))
    render(<Login onIn={vi.fn()} canReset />)
    await click(screen.getByRole('button', { name: /forgot password/i }))
    await waitFor(() => expect(codeBox()).not.toBeNull())
    expect(document.activeElement).toBe(codeBox())
    fireEvent.change(codeBox()!, { target: { value: 'nope' } })
    for (const box of document.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]')) {
      fireEvent.change(box, { target: { value: 'a brand new passphrase' } })
    }
    const setPassword = () => screen.getByRole('button', { name: /set password/i })
    await click(setPassword())
    await waitFor(() => expect(setPassword().classList.contains('glim-shake')).toBe(true))
    expect(document.activeElement).toBe(codeBox())
  })

  it('follows a switch of the system between light and dark', () => {
    let light = false
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query.includes('light') ? light : !light
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }))
    render(<Login onIn={vi.fn()} />)
    light = true
    act(() => listeners.forEach((fn) => fn()))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
