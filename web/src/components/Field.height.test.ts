import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Controls that stand in a row with a field take a named height from Field.tsx
// rather than writing their own number. The values themselves are a design
// decision and are not checked, only that they live in one place.

const require_ = createRequire(import.meta.url)
const read = (rel: string) =>
  readFileSync(require_.resolve(rel).replace(/\.js$/, ''), 'utf8')

/** Class attributes, whether written as a string or a template literal. */
function classAttributes(source: string): string[] {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
    (m) => m[1] ?? m[2],
  )
}

describe('one height, named once', () => {
  it('is exported for anything that has to line up with a field', () => {
    expect(read('./Field.tsx')).toMatch(/export const CONTROL_H = '[^']+'/)
  })

  it('exports the one step up too, and it is a token as well', () => {
    const key = /export const KEY_CONTROL_H = '([^']+)'/.exec(read('./Field.tsx'))
    expect(key).not.toBeNull()
    expect((key as RegExpExecArray)[1]).toContain('--btn-h-key')
  })

  it('has exactly two named heights, because the language allows two', () => {
    const named = [...read('./Field.tsx').matchAll(/export const (\w*CONTROL_H) =/g)]
    expect(named.map((m) => m[1]).sort()).toEqual(['CONTROL_H', 'KEY_CONTROL_H'])
  })

  it.each([
    ['./Field.tsx', 'the fields themselves'],
    ['./Direction.tsx', 'the direction button in its row'],
  ])('%s takes it rather than writing its own', (file) => {
    const source = read(file)
    expect(source).toContain('CONTROL_H')

    // The multi-line box is not one row tall and so has no height class at all.
    const hardCoded = classAttributes(source).filter((c) =>
      /(^|\s)h-\d/.test(c),
    )
    expect(hardCoded, `hard-coded height in ${file}: ${hardCoded.join(' | ')}`)
      .toHaveLength(0)
  })

  it('gives the direction button room for its longest name', () => {
    // The name changes as the button cycles, and the row must not move when
    // it does.
    const source = read('./Direction.tsx')
    expect(source).toMatch(/groupStage\(DIRECTIONS\.map/)
    expect(source).toContain('minWidth: `var(--btn-w-${stage})`')
  })
})
