import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { LANGUAGES } from './i18n'

/**
 * Every language in the picker has a flag that will actually draw.
 *
 * The list carries an ISO 3166-1 region code per language and the picker turns
 * it into a `fi fi-<code>` class. A code with no rule behind it does not fail,
 * warn, or log: it renders an empty box the width of a flag, which looks like a
 * loading state and survives every review that reads the code rather than the
 * screen. The three regional entries are the ones to watch, because `es-ct`,
 * `es-ga` and `es-pv` are subdivisions rather than countries and a smaller
 * sprite set would not carry them.
 *
 * Read out of the installed stylesheet rather than from a list written down
 * here, so this checks what will ship instead of a second copy of the same
 * assumption.
 */
describe('the language flags', () => {
  // Read off the disk rather than imported. Vitest stubs CSS imports to an
  // empty module by default, so `import css from '...css?raw'` arrives empty:
  // the test then finds nothing, reports every one of the forty-two as missing,
  // and would have reported the same thing with the package uninstalled. A test
  // that cannot see the file it checks is not checking anything.
  const css = readFileSync(
    createRequire(import.meta.url).resolve('flag-icons/css/flag-icons.min.css'),
    'utf8',
  )

  it('all draw from the sprite that is installed', () => {
    const missing = LANGUAGES.filter((l) => !css.includes(`.fi-${l.flag}`)).map(
      (l) => `${l.code} (${l.flag})`,
    )
    expect(missing).toEqual([])
  })

  it('covers every language, so none of them falls back to nothing', () => {
    expect(LANGUAGES.every((l) => l.flag.length > 0)).toBe(true)
    expect(LANGUAGES.length).toBe(42)
  })
})
