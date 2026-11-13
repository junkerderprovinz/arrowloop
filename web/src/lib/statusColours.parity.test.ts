import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The phone copies the state colours from tokens.css by hand, since React
 * Native cannot read custom properties. Each palette there has to say what the
 * web's ramp says, or a ring or a badge changes colour between the two.
 */

const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../../../mobile/src/theme.ts', import.meta.url), 'utf8')

/** The lines of the block that opens on `opening`, up to its closing brace. */
function block(source: string, opening: string): string {
  const from = source.indexOf(opening)
  expect(from, `no block opens with ${opening}`).toBeGreaterThan(-1)
  return source.slice(from, source.indexOf('\n}', from))
}

function token(css: string, name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css)
  expect(m, `${name} is missing`).not.toBeNull()
  return (m?.[1] ?? '').trim().toLowerCase()
}

function colour(palette: string, name: string): string {
  const m = new RegExp(`\\b${name}: "([^"]+)"`).exec(palette)
  expect(m, `${name} is missing`).not.toBeNull()
  return (m?.[1] ?? '').toLowerCase()
}

const STATES = ['info', 'ok', 'fail', 'warn', 'neutral']

describe.each([
  ['dark', ':root,\n[data-theme="dark"] {', 'const dark: Palette = {'],
  ['light', '[data-theme="light"] {', 'const light: Palette = {'],
])('the phone on the %s ramp', (_, web, phone) => {
  const css = block(tokens, web)
  const palette = block(theme, phone)

  it.each(STATES)('draws %s as the web does', (state) => {
    expect(colour(palette, `${state}Ink`)).toBe(token(css, `--status-${state}-text`))
    expect(colour(palette, `${state}Solid`)).toBe(token(css, `--status-${state}-solid`))
  })
})
