import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hoverOver, INK_LIGHTNESS, oklabOf } from './oklab.ts'

const tokens = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8')

/** The first value tokens.css gives a custom property. */
function token(name: string): number {
  const found = tokens.match(new RegExp(`${name}:\\s*([0-9.]+)`))
  if (!found) throw new Error(`${name} is not in tokens.css`)
  return Number(found[1])
}

describe('ink lightness', () => {
  it('matches the steps tokens.css builds the accent ink with', () => {
    expect(INK_LIGHTNESS.light).toBe(token('--ink-l-light'))
    expect(INK_LIGHTNESS.dark).toBe(token('--ink-l-dark'))
  })
})

describe('hoverOver', () => {
  const surface3 = { dark: '#525252', light: '#D1D1D1' }

  it('keeps the lightness of the surface it stands for', () => {
    for (const ground of Object.values(surface3)) {
      expect(oklabOf(hoverOver(ground, '#0F62FE'))[0]).toBeCloseTo(oklabOf(ground)[0], 2)
    }
  })

  it('takes 30% of the accent chroma and leaves a grey accent grey', () => {
    const [, a, b] = oklabOf('#0F62FE')
    const [, ha, hb] = oklabOf(hoverOver(surface3.dark, '#0F62FE'))
    expect(ha).toBeCloseTo(a * 0.3, 2)
    expect(hb).toBeCloseTo(b * 0.3, 2)
    expect(hoverOver(surface3.dark, '#808080')).toBe(surface3.dark)
  })
})
