import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Under rainbow every selector on a settings page wears a colour of its own,
 * counted in the order they stand, so four selectors in one card show four
 * colours rather than one. Each takes the next position from the page's
 * counter, which hands them out in render order. This reads source; it does
 * not render.
 */

const DIR = new URL('../pages/settings/', import.meta.url)
const FILES = readdirSync(DIR).filter((f) => f.endsWith('Page.tsx'))

/** Each `<Selector ...>` element's opening tag, as text. */
function selectors(text: string): string[] {
  const out: string[] = []
  for (let i = text.indexOf('<Selector'); i !== -1; i = text.indexOf('<Selector', i + 1)) {
    out.push(text.slice(i, text.indexOf('/>', i)))
  }
  return out
}

describe('the settings selectors', () => {
  const found = FILES.flatMap((f) => selectors(readFileSync(new URL(f, DIR), 'utf8')).map((el) => ({ f, el })))

  it('are found at all', () => {
    expect(found.length).toBeGreaterThanOrEqual(6)
  })

  it('each take the next colour of their page', () => {
    const off = found.filter(({ el }) => !/\bhue=\{selectorHue\(\)\}/.test(el))
    expect(off.map(({ f, el }) => `${f}: ${el.split('\n')[0]}`)).toEqual([])
  })
})
