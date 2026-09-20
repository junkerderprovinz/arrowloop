import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { LANGUAGES } from './i18n'

/**
 * Every language in the picker has a flag that will draw. A `fi-<code>` class
 * with no rule behind it renders an empty box without any error; the regional
 * `es-ct`, `es-ga` and `es-pv` are the likeliest to be missing.
 */
describe('the language flags', () => {
  // Read off the disk, because Vitest stubs CSS imports to an empty module.
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
