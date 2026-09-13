import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * NO HOOK BELOW AN EARLY RETURN, in any screen of the app.
 *
 * React counts hooks per render, so a `useState` placed after a conditional
 * return runs on some renders and not on others - and that does not misbehave
 * quietly, it takes the whole app down with "rendered more hooks than during the
 * previous render".
 *
 * Shipped once, on 2026-09-13: the target editor's test button got its state
 * beside the function that used it, which put it below
 * `if (!backendName) return <Empty/>`. Every check passed, because the screen
 * only crashes on a COLD open - the first render, before the backend list has
 * arrived, is the one with fewer hooks. jdp opened it cold: "ich kann die ziele
 * nicht bearbeiten, app stuerzt ab."
 *
 * Neither the compiler nor any test in this repo can see it: the types are fine,
 * and no renderer here reaches a phone. eslint's `react-hooks/rules-of-hooks`
 * would catch it, and this project has no eslint configuration - so the rule
 * lives here, read out of the source, until it does.
 *
 * THE SHAPE IT LOOKS FOR: a top-level `if (...) {` whose body returns, and after
 * it, at the same top level of the same function, a line that calls a hook. Both
 * anchored to two-space indentation, which is what a function body in these
 * files is; anything deeper is inside a callback, where a hook would be a
 * different mistake that this guard does not claim to catch.
 */
describe('hooks come before any early return', () => {
  const dir = new URL('../../../mobile/src/screens/', import.meta.url)
  const screens = readdirSync(dir).filter((f) => f.endsWith('.tsx'))

  it('has screens to check at all', () => {
    // A guard that found no files would pass silently, which is the same
    // blindness it exists to prevent.
    expect(screens.length).toBeGreaterThan(5)
  })

  it.each(screens)('%s', (file) => {
    const lines = readFileSync(new URL(file, dir), 'utf8').split('\n')

    let returnedAt = -1
    const offenders: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''

      // A new function body resets the question: a hook in the NEXT component
      // has nothing to do with an early return in the previous one.
      if (/^(export )?function /.test(line)) returnedAt = -1

      if (returnedAt === -1 && /^ {2}if \(.*\)\s*\{\s*$/.test(line)) {
        // Does it return within the next few lines, at the body's own depth?
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (/^ {4}return\b/.test(lines[j] ?? '')) {
            returnedAt = i
            break
          }
          if (/^ {2}\}/.test(lines[j] ?? '')) break
        }
        continue
      }

      if (returnedAt !== -1 && /^ {2}(const .*=\s*)?use[A-Z]\w*\(/.test(line)) {
        offenders.push(`line ${i + 1}: ${line.trim()} (after the return at line ${returnedAt + 1})`)
      }
    }

    expect(offenders, `hooks below an early return in mobile/src/screens/${file}`).toEqual([])
  })
})
