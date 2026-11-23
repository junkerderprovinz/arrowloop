// @vitest-environment jsdom
// The gate in front of the app: open while nobody can sign in, the kit's
// sign-in page while nobody has, and back to it once a call says the session
// ended.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job, Run, RunEvent, TrashSide } from './lib/api'

const jobs = vi.fn(() => Promise.resolve([] as Job[]))

vi.mock('./lib/api', async (actual) => ({
  ...(await actual<typeof import('./lib/api')>()),
  api: {
    jobs: () => jobs(),
    history: () => Promise.resolve([] as Run[]),
    volumes: () => Promise.resolve({ volumes: [] }),
    capabilities: () => Promise.resolve({ window: false, security: true, version: 'test' }),
    conflicts: () => Promise.resolve({ conflicts: [], unread: [] }),
    anomalies: () => Promise.resolve({ open: [], closed: [] }),
    learning: () => Promise.resolve([]),
    trashAll: () => Promise.resolve({ sides: [] as TrashSide[] }),
    volumeCandidates: () => Promise.resolve({ candidates: [] }),
    config: () => Promise.resolve({ jobs: [] }),
    settings: () => Promise.resolve({}),
    remotes: () => Promise.resolve({ remotes: [], backends: [], providers: [], unlisted: [] }),
    instances: () => Promise.resolve([]),
    autoBackups: () => Promise.resolve({ on: false, folder: '', files: [], last: null }),
    watch: (_: (ev: RunEvent) => void) => () => undefined,
  },
}))

const { Gate } = await import('./App')
const { signIn } = await import('./lib/signIn')
const real = await vi.importActual<typeof import('./lib/api')>('./lib/api')

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

type Answer = { status?: number; body?: unknown }
let script: Record<string, Answer | Answer[]> = {}
const sent: string[] = []
const offer = (more: Record<string, unknown> = {}) => ({
  open: false,
  owner: true,
  minPassword: 12,
  signedIn: false,
  passkeys: false,
  services: [],
  ...more,
})

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  sessionStorage.clear()
  jobs.mockReset()
  jobs.mockImplementation(() => Promise.resolve([]))
  sent.length = 0
  script = {}
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url.replace(/^.*\/api\/signin\/v1\//, '')}`
    sent.push(key)
    const entry = script[key]
    const a = (Array.isArray(entry) ? entry.shift() : entry) ?? { status: 404, body: { error: 'notFound' } }
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const signInPage = () => document.querySelector('.glim-signin-form')
// The buttons drawn as buttons. Forgot password? is a link under them.
const buttons = () => [...document.querySelectorAll<HTMLElement>('.glim-signin-form .glim-btn[data-signin]')].map((b) => b.dataset.signin)

describe('the gate', () => {
  it('opens an app nobody can sign in to without a sign-in page or a way to sign out', async () => {
    script['GET options'] = { body: offer({ open: true }) }
    render(<Gate />)
    expect(await screen.findByRole('heading', { name: 'Welcome to ArrowLoop' })).toBeTruthy()
    expect(signInPage()).toBeNull()
    expect(screen.queryByText('Sign out')).toBeNull()
  })

  it('offers to sign out once a password closes the app', async () => {
    script['GET options'] = [{ body: offer({ open: true }) }, { body: offer({ signedIn: true }) }]
    script['PUT me/password'] = { body: {} }
    render(<Gate />)
    expect(await screen.findByRole('heading', { name: 'Welcome to ArrowLoop' })).toBeTruthy()
    expect(screen.queryByText('Sign out')).toBeNull()

    await act(async () => {
      await signIn.setPassword({ next: 'correct horse battery staple' })
    })

    await waitFor(() => expect(screen.getAllByText('Sign out').length).toBeGreaterThan(0))
    expect(signInPage()).toBeNull()
  })

  it('asks a closed app for the password alone, with Sign in and Forgot password?', async () => {
    script['GET options'] = [{ body: offer() }, { body: offer({ signedIn: true }) }]
    script['POST login'] = { body: { visitor: { role: 'admin', via: 'password' } } }
    render(<Gate />)
    await waitFor(() => expect(signInPage()).not.toBeNull())
    expect(document.querySelector('#login-password')).not.toBeNull()
    expect(buttons()).toEqual(['submit'])
    expect(screen.getByText('Forgot password?').className).toBe('glim-signin-forgot')

    fireEvent.change(document.querySelector('#login-password')!, { target: { value: 'hunter2' } })
    fireEvent.submit(signInPage()!)

    expect(await screen.findByRole('heading', { name: 'Welcome to ArrowLoop' })).toBeTruthy()
    expect(sent).toContain('POST login')
    expect(screen.getAllByText('Sign out').length).toBeGreaterThan(0)
  })

  it('puts the sign-in service that is on under Sign in as the one other button', async () => {
    script['GET options'] = { body: offer({ services: [{ id: 'pid', provider: 'pocket-id', name: '' }] }) }
    render(<Gate />)
    await waitFor(() => expect(signInPage()).not.toBeNull())
    expect(buttons()).toEqual(['submit', 'service'])
    expect(screen.getByRole('button', { name: /Pocket ID/ })).toBeTruthy()
  })

  it('says why a sign-in service sent the browser back', async () => {
    window.history.replaceState(null, '', '/?signin=noAccount')
    script['GET options'] = { body: offer() }
    render(<Gate />)
    expect((await screen.findByRole('alert')).textContent).toBe("There's no account here for that person yet.")
  })

  it('goes back to the sign-in page once a call says the session ended', async () => {
    script['GET options'] = [{ body: offer({ signedIn: true }) }, { body: offer() }]
    jobs.mockImplementation(() => real.api.jobs())
    const guard = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'signInFirst', error: 'sign in first' }), { status: 401 }),
    )
    const kit = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (url.includes('/api/signin/') ? kit(url, init) : guard()))

    await act(async () => {
      render(<Gate />)
    })

    expect((await screen.findByRole('status')).textContent).toBe('Your session ran out. Please sign in again.')
    expect(signInPage()).not.toBeNull()
  })
})
