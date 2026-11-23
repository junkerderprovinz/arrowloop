// @vitest-environment jsdom
// The Security tile is GlimStone's sign-in tile on the kit's sign-in. While
// ARROWLOOP_PASSWORD_HASH sets the password, its card says so in place of the
// controls the interface cannot use.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let fromEnv = false
vi.mock('../lib/api', async (actual) => ({
  ...(await actual<typeof import('../lib/api')>()),
  api: {
    capabilities: () => Promise.resolve({ window: false, security: true, passwordFromEnv: fromEnv, version: 'test' }),
  },
}))

import { ToastProvider } from '../lib/toast'
import { Security } from './Security'

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const ANSWERS: Record<string, unknown> = {
  options: { open: false, owner: true, minPassword: 12, signedIn: true, passkeys: true, services: [] },
  me: { role: 'admin', via: 'password', owner: true, password: true, twoFactor: false, recoveryLeft: 0, fresh: true, askPassword: true },
  settings: { askPassword: true },
  roles: { roles: ['admin'], serviceRole: 'admin' },
}

beforeEach(() => {
  fromEnv = false
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.replace(/^.*\/api\/signin\/v1\//, '')
    return new Response(JSON.stringify(ANSWERS[path] ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function show() {
  render(
    <ToastProvider>
      <Security />
    </ToastProvider>,
  )
}

const card = (name: string) => document.querySelector<HTMLElement>(`[data-signin-card="${name}"]`)

describe('the Security tile', () => {
  it('lets the password be changed and removed where the interface sets it', async () => {
    show()
    await waitFor(() => expect(card('password')).not.toBeNull())
    const password = within(card('password')!)
    expect(await password.findByRole('button', { name: 'Change' })).toBeTruthy()
    expect(password.getByRole('button', { name: 'Remove password' })).toBeTruthy()
    expect(card('twoFactor')).not.toBeNull()
    expect(card('accounts')).toBeNull()
  })

  it('says where the password comes from while ARROWLOOP_PASSWORD_HASH sets it', async () => {
    fromEnv = true
    show()
    await waitFor(() => expect(card('password')).not.toBeNull())
    const password = card('password')!
    expect(password.textContent).toContain('Set through ARROWLOOP_PASSWORD_HASH.')
    expect(within(password).queryByRole('button')).toBeNull()
    await waitFor(() => expect(card('twoFactor')).not.toBeNull())
    expect(document.querySelectorAll('[data-signin-card="password"]')).toHaveLength(1)
  })

  it("offers a new token the two scopes in ArrowLoop's own words", async () => {
    show()
    await waitFor(() => expect(card('tokens')).not.toBeNull())
    fireEvent.click(await within(card('tokens')!).findByRole('button', { name: 'Create a token' }))
    expect(await screen.findByText('Status and log')).toBeTruthy()
    expect(screen.getByText('Everything')).toBeTruthy()
  })
})
