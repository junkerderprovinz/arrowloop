// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let targets = 0

vi.mock('../lib/api', async (actual) => ({
  ...(await actual<typeof import('../lib/api')>()),
  api: {
    remotes: () => Promise.resolve({ remotes: Array.from({ length: targets }, (_, i) => ({ name: `t${i}` })) }),
    volumeCandidates: () => Promise.resolve({ candidates: [] }),
    volumes: () => Promise.resolve({ volumes: [] }),
  },
}))

const { Welcome } = await import('./Welcome')

// jsdom has no ResizeObserver, which the step scene uses to place its pointer.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  targets = 0
})

async function marks() {
  const view = render(<Welcome fresh />)
  await act(async () => {})
  return [...view.container.querySelectorAll<HTMLElement>('.al-step-mark')]
}

describe('the step marks on the welcome page', () => {
  it('wear the accent on every step, whatever its state', async () => {
    targets = 1
    const all = await marks()
    expect(all.map((m) => m.dataset.state)).toEqual(['done', 'next', 'open'])
    for (const m of all) expect([...m.classList]).toEqual(expect.arrayContaining(['bg-accent', 'text-accentContrast']))
  })

  it('run the ring round a step that is done while the page is open', async () => {
    targets = 1
    const [target, job] = await marks()
    expect(target?.classList.contains('al-step-fresh')).toBe(true)
    expect(job?.classList.contains('al-step-fresh')).toBe(false)
  })

  it('leave the ring out where nothing was done', async () => {
    const all = await marks()
    expect(all.some((m) => m.classList.contains('al-step-fresh'))).toBe(false)
  })
})
