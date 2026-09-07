import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Everything that stands in a row with a field is the same height.
 *
 * This is a guard against a class of report rather than against one bug. The
 * direction button was written as h-9 and the inputs took their 32px from
 * py-2 on text-xs; neither number was wrong on its own and side by side the
 * button was visibly taller (jdp: "der button ist groesser als die felder
 * daneben"). Two controls that must match had been given two numbers, in two
 * files, and nothing could notice.
 *
 * So the height has a name now, and this file checks the name is what the call
 * sites use. It deliberately does NOT check the value: 32 or 36 is a design
 * decision that may change, and it may only change in ONE place.
 *
 * There are TWO names since GlimStone 1.7.5, and that changes nothing about
 * what this file is for. `CONTROL_H` is what stands in a row with a field;
 * `KEY_CONTROL_H` is the one step up, for a control that carries a decision.
 * The guard follows the same shape for both: each is declared once, each call
 * site names it rather than writing a number, and the editor's spacer column
 * lines up with whichever one the direction button actually took. A second
 * NAMED height is a design decision; a second number written out by hand at a
 * call site is the bug this file exists to catch, and it still is.
 */

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
    // Not pedantry. One height is what a field measures and the second is the
    // deliberate step up; a third would turn every button into an argument
    // about which rung it takes, which is the reason GlimStone says two and
    // says it will not be three.
    const named = [...read('./Field.tsx').matchAll(/export const (\w*CONTROL_H) =/g)]
    expect(named.map((m) => m[1]).sort()).toEqual(['CONTROL_H', 'KEY_CONTROL_H'])
  })

  it.each([
    ['./Field.tsx', 'the fields themselves'],
    ['./Direction.tsx', 'the direction button between two of them'],
  ])('%s takes it rather than writing its own', (file) => {
    const source = read(file)
    expect(source).toContain('CONTROL_H')

    // A hard-coded height on a control is the exact mistake this file exists to
    // catch. The multi-line box is the one thing in here that is deliberately
    // not one row tall, and it says so by having no height class at all.
    const hardCoded = classAttributes(source).filter((c) =>
      /(^|\s)h-\d/.test(c),
    )
    expect(hardCoded, `hard-coded height in ${file}: ${hardCoded.join(' | ')}`)
      .toHaveLength(0)
  })

  it('reads the same token the editor lines its rows up with', () => {
    // Not tidiness. The editor's name row holds its middle column open with a
    // spacer, and that spacer stands in for the direction button below it. A
    // plain h-8 here AGREED with the token by coincidence, and the first change
    // to either number would have pulled two rows out of line somewhere nobody
    // was looking - which is exactly what raising the direction button to the
    // key height would have done, so the spacer has to follow the button's own
    // token rather than the one the button used to take.
    const token = /(?<!KEY_)CONTROL_H = '([^']+)'/.exec(read('./Field.tsx'))
    expect(token).not.toBeNull()
    expect((token as RegExpExecArray)[1]).toContain('--btn-h')

    const key = /KEY_CONTROL_H = '(?:h-)?\[?([^'\]]+)\]?'/.exec(read('./Field.tsx'))
    expect(key).not.toBeNull()
    expect(read('../pages/Editor.tsx')).toContain((key as RegExpExecArray)[1])
  })

  it('gives the direction button a square footprint', () => {
    // A glyph-only button that is one row tall and a different number wide
    // reads as a stretched or squashed square rather than as a control, and
    // it also stops lining up with the spacer that stands in for it.
    const row = classAttributes(read('./Direction.tsx')).find((c) =>
      c.includes('CONTROL_H'),
    )
    expect(row).toBeDefined()
    const width = /(?:^|\s)w-\[?([^\s\]]+)\]?/.exec(row as string)
    expect(width, 'the direction button needs an explicit width').not.toBeNull()
    const height = /KEY_CONTROL_H = '(?:h-)?\[?([^'\]]+)\]?'/.exec(read('./Field.tsx'))
    expect(height).not.toBeNull()
    expect((width as RegExpExecArray)[1]).toBe((height as RegExpExecArray)[1])
  })
})
