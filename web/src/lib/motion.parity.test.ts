import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { MOTION_VALUES } from './motion'

/**
 * Every motion level answers every one of the app's own dials. A level that
 * leaves one out inherits the bare :root value, which is the lively one, and
 * the block still reads as complete because each line in it is right.
 */

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

/** The --motion-* names one single-line block declares. */
function dials(selector: string): string[] {
  const line = css.split('\n').find((l) => l.startsWith(`${selector} {`))
  expect(line, `${selector} has no block in index.css`).toBeDefined()
  return [...(line ?? '').matchAll(/(--motion-[\w-]+):/g)].map((m) => m[1] ?? '')
}

describe('the app motion dials', () => {
  const lively = dials(':root')

  it('reads the lively block at all', () => {
    expect(lively).toContain('--motion-logo-dur')
  })

  it.each(MOTION_VALUES.filter((v) => v !== 'wild'))('are all answered at %s', (level) => {
    expect(dials(`:root[data-motion='${level}']`).sort()).toEqual([...lively].sort())
  })
})
