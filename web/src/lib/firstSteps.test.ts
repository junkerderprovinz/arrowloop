import { describe, expect, it } from 'vitest'

import { foundLine, stepStates } from './firstSteps'
import { en } from './i18n'

const t = (key: keyof typeof en, vars?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (all, name: string) => String(vars?.[name] ?? all))

describe('the first steps', () => {
  it('start with the target', () => {
    expect(stepStates(false)).toEqual({ target: 'next', job: 'open', preview: 'open' })
  })

  it('move on to the job once a target is there', () => {
    expect(stepStates(true)).toEqual({ target: 'done', job: 'next', preview: 'open' })
  })

  it('name what the machine already holds', () => {
    expect(foundLine({ targets: 2, drives: 3 }, t)).toBe('Targets rclone already knows: 2 · Drives: 3')
    expect(foundLine({ targets: 0, drives: 1 }, t)).toBe('Drives: 1')
  })

  it('say nothing where nothing was found', () => {
    expect(foundLine({ targets: 0, drives: 0 }, t)).toBeNull()
  })
})
