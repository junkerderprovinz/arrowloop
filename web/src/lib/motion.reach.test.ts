import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The logo's morph leaves its own box only where nobody is watching.
 *
 * The rail clips whatever leaves the box, and `overflow: visible` on the mark
 * cannot undo that, so an arrow outside it has to be hidden or fading out. The
 * stylesheet is read directly, because a unit test has no layout.
 */

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

/** Half the drawing's box, in its own units: past this the centre is outside. */
const HALF_BOX = 205.87

interface Step {
  at: number[]
  body: string
}

/** The steps of one @keyframes block, each with the percentages it names. */
function keyframes(name: string): Step[] {
  const at = css.indexOf(`@keyframes ${name} {`)
  expect(at, `@keyframes ${name} is not in index.css`).toBeGreaterThan(-1)
  const steps: Step[] = []
  let i = css.indexOf('{', at) + 1
  for (;;) {
    const open = css.indexOf('{', i)
    const close = css.indexOf('}', i)
    if (close < open || open === -1) break
    const pct = [...css.slice(i, open).matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]))
    const end = css.indexOf('}', open)
    steps.push({ at: pct, body: css.slice(open + 1, end) })
    i = end + 1
  }
  return steps
}

/** How far one step's translate() carries the element along either axis. */
function reach(step: Step): number {
  const m = /translate\(([^)]*)\)/.exec(step.body)
  if (!m) return 0
  return Math.max(...(m[1] ?? '').split(',').map((v) => Math.abs(parseFloat(v))))
}

const hidden = (step: Step) => /opacity:\s*0\s*;/.test(step.body)

describe("the logo's morph stays where it can be seen", () => {
  it('reads the keyframes at all', () => {
    // Without this a broken parser reports perfect behaviour of nothing.
    expect(keyframes('al-logo-out-up').length).toBe(3)
    expect(keyframes('al-logo-in-up').length).toBe(4)
    expect(Math.max(...keyframes('al-logo-out-up').map(reach))).toBeGreaterThan(HALF_BOX)
  })

  it('throws the drawn arrows out of the box only as they vanish', () => {
    for (const name of ['al-logo-out-up', 'al-logo-out-down']) {
      const visibleOutside = keyframes(name).filter((s) => reach(s) > HALF_BOX && !hidden(s))
      expect(visibleOutside, `${name} leaves the box while still visible`).toEqual([])
    }
  })

  it('brings the real arrows in from outside only while they are hidden', () => {
    const real = keyframes('al-logo-real').filter(hidden).flatMap((s) => s.at)
    const from = Math.min(...real)
    const to = Math.max(...real)
    for (const name of ['al-logo-in-up', 'al-logo-in-down']) {
      const outside = keyframes(name)
        .filter((s) => reach(s) > HALF_BOX)
        .flatMap((s) => s.at)
      expect(outside.length, `${name} never leaves the box`).toBeGreaterThan(0)
      expect(
        outside.filter((p) => p < from || p > to),
        `${name} is outside the box while al-logo-real shows it`,
      ).toEqual([])
    }
  })

  // A scale past the box clips just like a translate out of it.
  it('does not grow the rings far out of the box', () => {
    const scales = keyframes('al-logo-rings').flatMap((s) =>
      [...s.body.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1])),
    )
    expect(scales.length).toBeGreaterThan(1)
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.1)
  })
})
