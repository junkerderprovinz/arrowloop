import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// The components come from the vendored GlimStone package and draw with the
// classes of its tokens.css, so a copy that falls behind leaves new parts of
// them unstyled.
const require = createRequire(import.meta.url)
const source = (file: string) => readFileSync(require.resolve(`@glimstone/core/${file}`), 'utf8')
const local = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

describe('the copies of GlimStone', () => {
  it('carry the tokens of the vendored package', () => {
    const copy = local('tokens.css')
    const copied = copy.slice(copy.indexOf('*/') + 2, copy.indexOf('\n/* Local addition'))
    expect(copied.trim() === source('tokens.css').trim(), 'copy packages/core/tokens.css into web/src/tokens.css again').toBe(true)
  })

  it('carry the Tailwind theme of the vendored package', () => {
    expect(local('tailwind-theme.css') === source('tailwind-theme.css'), 'copy packages/core/tailwind-theme.css again').toBe(true)
  })
})
