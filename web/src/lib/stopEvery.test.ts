import { describe, expect, it } from 'vitest'

import { stopEvery } from './stopEvery'

/** An engine whose jobs keep running for `lag` more questions after a stop. */
function engine(running: string[], lag: number) {
  const left = new Map(running.map((name) => [name, Infinity]))
  const stopped: string[] = []
  return {
    stopped,
    jobs: async () => {
      for (const [name, n] of left) left.set(name, n - 1)
      return [...left].map(([name, n]) => ({ name, running: n > 0 }))
    },
    stop: async (name: string) => {
      stopped.push(name)
      left.set(name, lag)
    },
  }
}

const now = () => {
  let at = 0
  return { clock: () => at, sleep: async (ms: number) => void (at += ms) }
}

describe('stopEvery', () => {
  it('stops what runs when asked and waits until the runs have ended', async () => {
    const e = engine(['photos', 'music'], 3)
    let asked = 0
    const jobs = e.jobs
    e.jobs = async () => {
      asked++
      return jobs()
    }
    expect(await stopEvery(e, { within: 10_000, every: 100, ...now() })).toBe(true)
    expect(e.stopped.sort()).toEqual(['music', 'photos'])
    expect(asked).toBeGreaterThan(1)
    expect((await e.jobs()).some((j) => j.running)).toBe(false)
  })

  it('gives up when a run does not end in time', async () => {
    const e = engine(['photos'], 1_000)
    expect(await stopEvery(e, { within: 1_000, every: 100, ...now() })).toBe(false)
  })
})
