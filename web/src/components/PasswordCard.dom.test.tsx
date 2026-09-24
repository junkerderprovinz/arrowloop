// @vitest-environment jsdom
// The password card changes who can reach a program that deletes files, so the
// cases worth guarding are the ones that would change it by accident: a typo
// in the new password, a change or removal without the current one, and a
// password from the environment that the card must not pretend to own.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setPassword = vi.fn()
const removePassword = vi.fn()
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    setPassword: (p: string, c: string) => setPassword(p, c),
    removePassword: (c: string) => removePassword(c),
  },
}))

import { ApiError, type SecurityStatus } from '../lib/api'
import { PasswordCard } from './PasswordCard'

const none: SecurityStatus = { available: true, password: 'none', minPasswordLen: 12, twoFactor: false, recoveryCodesLeft: 0 }
const file: SecurityStatus = { ...none, password: 'file' }

beforeEach(() => {
  setPassword.mockReset()
  removePassword.mockReset()
})
afterEach(cleanup)

function fill(selector: string, value: string, index = 0) {
  const box = document.querySelectorAll<HTMLInputElement>(selector)[index]
  fireEvent.change(box, { target: { value } })
}

function click(name: RegExp) {
  return act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

describe('PasswordCard', () => {
  it('sets the first password without asking for a current one', async () => {
    setPassword.mockResolvedValue(file)
    const onChanged = vi.fn()
    render(<PasswordCard status={none} onChanged={onChanged} />)
    expect(document.querySelector('input[autocomplete="current-password"]')).toBeNull()

    fill('input[autocomplete="new-password"]', 'a long enough one', 0)
    fill('input[autocomplete="new-password"]', 'a long enough one', 1)
    await click(/set password/i)

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(file))
    expect(setPassword).toHaveBeenCalledWith('a long enough one', '')
  })

  it('refuses two passwords that differ before asking the server', async () => {
    render(<PasswordCard status={none} onChanged={vi.fn()} />)
    fill('input[autocomplete="new-password"]', 'a long enough one', 0)
    fill('input[autocomplete="new-password"]', 'a long enough 0ne', 1)
    await click(/set password/i)
    expect(screen.getByRole('alert').textContent).toMatch(/do not match/i)
    expect(setPassword).not.toHaveBeenCalled()
  })

  it('refuses a short password before asking the server', async () => {
    render(<PasswordCard status={none} onChanged={vi.fn()} />)
    fill('input[autocomplete="new-password"]', 'short', 0)
    fill('input[autocomplete="new-password"]', 'short', 1)
    await click(/set password/i)
    expect(screen.getByRole('alert').textContent).toMatch(/12/)
    expect(setPassword).not.toHaveBeenCalled()
  })

  it('wants the current password for a change, and says so when it is wrong', async () => {
    setPassword.mockRejectedValue(new ApiError('the current password is not right', 403))
    render(<PasswordCard status={file} onChanged={vi.fn()} />)

    fill('input[autocomplete="new-password"]', 'a longer one than before', 0)
    fill('input[autocomplete="new-password"]', 'a longer one than before', 1)
    await click(/change password/i)
    expect(screen.getByRole('alert').textContent).toMatch(/current password/i)
    expect(setPassword).not.toHaveBeenCalled()

    fill('input[autocomplete="current-password"]', 'not it')
    await click(/change password/i)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not right/i))
    expect(setPassword).toHaveBeenCalledWith('a longer one than before', 'not it')
  })

  it('removes the password only after a confirmation and with the current one', async () => {
    removePassword.mockResolvedValue(none)
    const onChanged = vi.fn()
    render(<PasswordCard status={file} onChanged={onChanged} />)

    // Always drawn, not revealed on hover.
    await click(/remove password/i)
    expect(screen.getByRole('alert').textContent).toMatch(/current password/i)

    fill('input[autocomplete="current-password"]', 'the right one')
    await click(/remove password/i)
    expect(removePassword).not.toHaveBeenCalled()
    const confirm = screen.getAllByRole('button', { name: /remove password/i })
    await act(async () => {
      fireEvent.click(confirm[confirm.length - 1])
    })
    await waitFor(() => expect(removePassword).toHaveBeenCalledWith('the right one'))
    expect(onChanged).toHaveBeenCalledWith(none)
  })

  it('shows a password from the environment without a form to change it', () => {
    render(<PasswordCard status={{ ...none, password: 'env' }} onChanged={vi.fn()} />)
    expect(screen.getByText(/ARROWLOOP_PASSWORD_HASH/)).toBeTruthy()
    expect(document.querySelector('input')).toBeNull()
    expect(screen.queryByRole('button', { name: /remove password/i })).toBeNull()
  })
})
