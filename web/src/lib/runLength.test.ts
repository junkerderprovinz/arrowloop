import { describe, expect, it } from 'vitest'

import { en } from './i18n.data'
import { runLength } from './runLength'

const t = (key: keyof typeof en, vars?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (all, name: string) => String(vars?.[name] ?? all))

const run = (started: string, finished: string, running = false) => ({ Started: started, Finished: finished, Running: running })

describe('runLength', () => {
  it('keeps half a minute from reading as a time of day', () => {
    expect(runLength(run('2026-11-16T20:27:00Z', '2026-11-16T20:27:31Z'), t)).toBe('31 s')
  })

  it('counts a longer run in minutes', () => {
    expect(runLength(run('2026-11-16T20:00:00Z', '2026-11-16T20:12:20Z'), t)).toBe('12 min')
  })

  it('gives a run still going no length yet', () => {
    expect(runLength(run('2026-11-16T20:00:00Z', ''), t)).toBeNull()
    expect(runLength(run('2026-11-16T20:00:00Z', '0001-01-01T00:00:00Z', true), t)).toBeNull()
  })
})
