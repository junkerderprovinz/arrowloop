import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { HUE_OFFSET } from '../components/Selector'

/**
 * No two selectors on one settings screen start on the same colour. A segment
 * takes its hue from its position, so stacked selectors of similar width
 * repeat every colour straight down the page unless each starts elsewhere.
 * This reads source; it does not render.
 */

const FILES = ['../App.tsx', '../pages/Engine.tsx']

/** Each `<Selector ...>` element's opening tag, as text. */
function selectors(text: string): string[] {
  const out: string[] = []
  for (let i = text.indexOf('<Selector'); i !== -1; i = text.indexOf('<Selector', i + 1)) {
    const end = text.indexOf('/>', i)
    out.push(text.slice(i, end))
  }
  return out
}

describe('the settings selectors', () => {
  const found = FILES.flatMap((f) =>
    selectors(readFileSync(new URL(f, import.meta.url), 'utf8')).map((el) => ({ f, el })),
  )

  it('are found at all', () => {
    expect(found.length).toBeGreaterThanOrEqual(8)
  })

  it('each start where the table says', () => {
    const missing = found.filter(({ el }) => !/hueOffset=\{HUE_OFFSET\.\w+/.test(el))
    expect(missing.map(({ f, el }) => `${f}: ${el.split('\n')[0]}`)).toEqual([])
  })

  it('give the look tab and the section tabs distinct starts', () => {
    const labels = [0, 1, 2].map((row) => HUE_OFFSET.labels + row)
    const look = [HUE_OFFSET.tabs, ...labels, HUE_OFFSET.shape, HUE_OFFSET.motion, HUE_OFFSET.theme]
    expect(new Set(look).size).toBe(look.length)
    const engine = [HUE_OFFSET.tabs, HUE_OFFSET.direction, HUE_OFFSET.mode, HUE_OFFSET.foldCase]
    expect(new Set(engine).size).toBe(engine.length)
  })
})
