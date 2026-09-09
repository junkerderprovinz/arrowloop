import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * An animation that cannot be SEEN has not been checked.
 *
 * The easter egg was reported broken twice. Both times the thing measured was
 * that the animation ran - `getAnimations()` said so, the transforms stepped
 * through their keyframes exactly as written - and both times the arrow was
 * behind a clipping edge for the whole of it. It travelled to 150% of its own
 * box while the running app gave it 24px of room above an 80px logo, so the
 * climb was gone before anybody could see it and what was left to watch was the
 * arrow blinking out and back.
 *
 * `overflow: visible` on the element does not help: the frame around the rail
 * clips it anyway, and no amount of CSS on the drawing can undo an ancestor's
 * clip. The only reliable answer is to keep the movement inside the box the
 * element already occupies, and that is what this checks - by reading the
 * stylesheet, because a unit test has no layout and a browser test that only
 * asks "is it animating" is exactly the test that missed this twice.
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

  /**
   * Half the drawing's own box, which is the distance at which its centre
   * reaches the box edge. Past that the shape is leaving the area it is
   * guaranteed to own, and whether any of it survives depends on what an
   * ancestor happens to clip - which is not something a stylesheet may assume.
   */
  it('never travels further than half its own box', () => {
    const tooFar = travels('al-shoot').filter((p) => p > 50)
    expect(
      tooFar,
      `these steps leave the drawing's own box, so whether they are visible ` +
        `depends on an ancestor's overflow rather than on this file: ${tooFar.join('%, ')}%`,
    ).toEqual([])
  })

  it('does not lean on overflow to be seen', () => {
    // The class may still set it - a shape at 34% with a shadow or a stroke can
    // graze the edge - but the movement must not DEPEND on it.
    const worst = Math.max(...travels('al-shoot'))
    expect(worst).toBeLessThanOrEqual(50)
  })

  /**
   * The rings turn rather than travel, so their own block is checked for the
   * opposite mistake: a scale that grows the drawing past its box has the same
   * clipping problem as a translate that moves it there.
   */
  it('does not grow the rings out of the box either', () => {
    const scales = [...keyframes('al-rings-settle').matchAll(/scale\(([\d.]+)\)/g)].map((m) =>
      Number(m[1]),
    )
    expect(scales.length).toBeGreaterThan(2)
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.1)
  })
})
