// @vitest-environment jsdom
// Resetting a forgotten password with the code from the log: the link shows
// only where a reset is possible, the code is never shown here, and the page
// says what went with the old password.
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
})
afterEach(cleanup)

async function click(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

function type(selector: string, value: string) {
  fireEvent.change(document.querySelector<HTMLInputElement>(selector)!, { target: { value } })
}

describe('Login, a forgotten password', () => {
  it('offers no reset where the password comes from elsewhere', () => {
    render(<Login onIn={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /forgot the password/i })).toBeNull()
  })

  it('asks for a code, takes it with the new password and says what went', async () => {
    resetBegin.mockResolvedValue({ minutes: 10 })
    resetFinish.mockResolvedValue({ removed: { secondFactor: true, passkeys: 2, sessions: 1 } })
    const onIn = vi.fn()
    render(<Login onIn={onIn} canReset />)

    await click(/forgot the password/i)
    await click(/write a code to the log/i)
    expect(resetBegin).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/valid for 10 minutes/i)).toBeTruthy()

    type('input[placeholder="ABCD-EFGH-JKLM"]', 'abcd-efgh-jklm')
    type('input[autocomplete="new-password"]', 'a brand new passphrase')
    await click(/set the password/i)
    expect(resetFinish).toHaveBeenCalledWith('abcd-efgh-jklm', 'a brand new passphrase')

    expect(await screen.findByText('two-factor authentication')).toBeTruthy()
    expect(screen.getByText('passkeys: 2')).toBeTruthy()
    expect(screen.getByText('other sessions: 1')).toBeTruthy()
    await click(/continue/i)
    expect(onIn).toHaveBeenCalledTimes(1)
  })

  it('answers a wrong code without saying whether a code is live', async () => {
    resetBegin.mockResolvedValue({ minutes: 10 })
    resetFinish.mockRejectedValue(new ApiError('that code is not valid or has expired', 400))
    render(<Login onIn={vi.fn()} canReset />)
    await click(/forgot the password/i)
    await click(/write a code to the log/i)
    type('input[placeholder="ABCD-EFGH-JKLM"]', 'nope')
    type('input[autocomplete="new-password"]', 'a brand new passphrase')
    await click(/set the password/i)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That code is not valid or has expired.'))
  })

  it('holds the new password back until it is long enough', async () => {
    resetBegin.mockResolvedValue({ minutes: 10 })
    render(<Login onIn={vi.fn()} canReset />)
    await click(/forgot the password/i)
    await click(/write a code to the log/i)
    type('input[placeholder="ABCD-EFGH-JKLM"]', 'ABCDEFGHJKLM')
    type('input[autocomplete="new-password"]', 'short')
    expect((screen.getByRole('button', { name: /set the password/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})
