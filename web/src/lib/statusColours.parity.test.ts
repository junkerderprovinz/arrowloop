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

/** An oklch() colour as the hex the phone writes for it, which React Native needs. */
function oklchHex(value: string): string {
  const [l = 0, c = 0, h = 0] = value.slice('oklch('.length, -1).trim().split(/\s+/).map(Number)
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const lms = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((v) => v ** 3)
  const [x = 0, y = 0, z = 0] = lms
  const rgb = [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ]
  const encode = (v: number) => {
    const s = Math.min(1, Math.max(0, v))
    return Math.round((s <= 0.0031308 ? 12.92 * s : 1.055 * s ** (1 / 2.4) - 0.055) * 255)
  }
  return '#' + rgb.map((v) => encode(v).toString(16).padStart(2, '0')).join('')
}

/** A token's value on one ramp. A light-dark() pair holds the light value first. */
function token(css: string, name: string, ramp: 'dark' | 'light'): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css)
  expect(m, `${name} is missing`).not.toBeNull()
  const value = (m?.[1] ?? '').trim().toLowerCase()
  if (!value.startsWith('light-dark(')) return value
  const inner = value.slice('light-dark('.length, -1)
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++
    else if (inner[i] === ')') depth--
    else if (inner[i] === ',' && depth === 0) {
      const side = (ramp === 'light' ? inner.slice(0, i) : inner.slice(i + 1)).trim()
      return side.startsWith('oklch(') ? oklchHex(side) : side
    }
  }
  return value
}

function colour(palette: string, name: string): string {
  const m = new RegExp(`\\b${name}: "([^"]+)"`).exec(palette)
  expect(m, `${name} is missing`).not.toBeNull()
  return (m?.[1] ?? '').toLowerCase()
}

const STATES = ['info', 'ok', 'fail', 'warn', 'neutral']

describe.each([
  ['dark', 'const dark: Palette = {'],
  ['light', 'const light: Palette = {'],
] as const)('the phone on the %s ramp', (ramp, phone) => {
  // Both themes are one light-dark() value, and the first one in the file is
  // the theme's own; the contrast levels follow further down.
  const css = tokens
  const palette = block(theme, phone)

  it.each(STATES)('draws %s as the web does', (state) => {
    expect(colour(palette, `${state}Ink`)).toBe(token(css, `--status-${state}-text`, ramp))
    expect(colour(palette, `${state}Solid`)).toBe(token(css, `--status-${state}-solid`, ramp))
  })
})
