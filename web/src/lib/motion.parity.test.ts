import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DEFAULT_MOTION, MOTION_VALUES } from './motion'

/**
 * Every motion level answers every dial. A level that leaves one out inherits
 * the bare :root value, which is the calm default, and the block still reads as
 * complete because each line in it is right.
 */

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')

/** The --motion-* names one single-line block declares. */
function dials(selector: string): string[] {
  const line = css.split('\n').find((l) => l.startsWith(`${selector} {`))
  expect(line, `${selector} has no block in index.css`).toBeDefined()
  return [...(line ?? '').matchAll(/(--motion-[\w-]+):/g)].map((m) => m[1] ?? '')
}

describe('the app motion dials', () => {
  const calm = dials(':root')

  it('reads the default block at all', () => {
    expect(calm).toContain('--motion-logo-dur')
  })

  it.each(MOTION_VALUES.filter((v) => v !== DEFAULT_MOTION))('are all answered at %s', (level) => {
    expect(dials(`:root[data-motion='${level}']`).sort()).toEqual([...calm].sort())
  })
})

const DIAL = /(--(?:motion|drag)-[a-z-]+)\s*:/g

/** The dials declared in every innermost rule whose selector is exactly `selector`. */
function declared(sheet: string, selector: string): Set<string> {
  const names = new Set<string>()
  for (const rule of sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rule[1]?.trim() !== selector) continue
    for (const dial of (rule[2] ?? '').matchAll(DIAL)) names.add(dial[1] ?? '')
  }
  return names
}

describe("GlimStone's motion dials", () => {
  const others = MOTION_VALUES.filter((v) => v !== DEFAULT_MOTION)
  const byLevel = Object.fromEntries(others.map((l) => [l, declared(tokens, `:root[data-motion='${l}']`)]))
  // A dial is whatever some level sets; the calm default is the bare :root.
  const all = new Set(others.flatMap((l) => [...(byLevel[l] ?? [])]))

  it('finds the dials at all', () => {
    expect(all.size).toBeGreaterThanOrEqual(15)
  })

  it('are all declared by the calm default', () => {
    const root = declared(tokens, ':root')
    expect([...all].filter((d) => !root.has(d))).toEqual([])
  })

  it('are never keyed to the default level by name', () => {
    for (const sheet of [tokens, css]) {
      expect(sheet).not.toMatch(/data-motion=['"]subtle['"]/)
    }
  })
})
