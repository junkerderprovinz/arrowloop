import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The easter egg's movement stays inside the element's own box.
 *
 * An animation that runs can still be invisible: an ancestor's clip hides
 * anything that leaves the box, and `overflow: visible` on the element cannot
 * undo that. The stylesheet is read directly, because a unit test has no layout.
 */

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

/** The body of one @keyframes block. */
function keyframes(name: string): string {
  const at = css.indexOf(`@keyframes ${name} {`)
  expect(at, `@keyframes ${name} is not in index.css`).toBeGreaterThan(-1)
  const from = css.indexOf('{', at) + 1
  // The block has one nesting level (the percentage steps), so the closing
  // brace is the one after the last step's.
  let depth = 1
  let i = from
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
    i++
  }
  return css.slice(from, i - 1)
}

/** Every percentage passed to translate() in one keyframes block. */
function travels(name: string): number[] {
  const out: number[] = []
  for (const m of keyframes(name).matchAll(/translate\(([^)]*)\)/g)) {
    for (const part of (m[1] ?? '').split(',')) {
      const pct = /(-?[\d.]+)%/.exec(part.trim())
      if (pct) out.push(Math.abs(Number(pct[1])))
    }
  }
  return out
}

describe('the easter egg stays where it can be seen', () => {
  it('reads the keyframes at all', () => {
    // Without this a broken parser reports perfect behaviour of nothing.
    expect(travels('al-shoot').length).toBeGreaterThan(4)
  })

  // At half its box the drawing's centre reaches the box edge.
  it('never travels further than half its own box', () => {
    const tooFar = travels('al-shoot').filter((p) => p > 50)
    expect(
      tooFar,
      `these steps leave the drawing's own box, so whether they are visible ` +
        `depends on an ancestor's overflow rather than on this file: ${tooFar.join('%, ')}%`,
    ).toEqual([])
  })

  it('does not lean on overflow to be seen', () => {
    // The class may still set overflow for a shadow that grazes the edge, but
    // the movement must not depend on it.
    const worst = Math.max(...travels('al-shoot'))
    expect(worst).toBeLessThanOrEqual(50)
  })

  // A scale past the box clips just like a translate out of it.
  it('does not grow the rings out of the box either', () => {
    const scales = [...keyframes('al-rings-settle').matchAll(/scale\(([\d.]+)\)/g)].map((m) =>
      Number(m[1]),
    )
    expect(scales.length).toBeGreaterThan(2)
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.1)
  })
})
