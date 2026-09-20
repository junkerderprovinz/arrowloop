import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * No hook below an early return, in any screen of the phone app.
 *
 * React counts hooks per render, so a hook after a conditional return crashes
 * the app with "rendered more hooks than during the previous render", often only
 * on a cold open. The project has no ESLint to run `react-hooks/rules-of-hooks`,
 * so this reads the source instead: a top-level `if (...) {` that returns,
 * followed at the same two-space depth by a hook call.
 */
describe('hooks come before any early return', () => {
  const dir = new URL('../../../mobile/src/screens/', import.meta.url)
  const screens = readdirSync(dir).filter((f) => f.endsWith('.tsx'))

  it('has screens to check at all', () => {
    // A guard that found no files would pass silently.
    expect(screens.length).toBeGreaterThan(5)
  })

  it.each(screens)('%s', (file) => {
    const lines = readFileSync(new URL(file, dir), 'utf8').split('\n')

    let returnedAt = -1
    const offenders: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''

      // A new function body starts over.
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
