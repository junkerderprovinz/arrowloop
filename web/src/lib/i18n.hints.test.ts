import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * An explanation belongs in a bubble, never printed on the page.
 *
 * The design language has said so since rule 8 was written: prose under a
 * control is read once and then costs vertical space for ever, and a page of
 * grey paragraphs hides the controls it was meant to clarify. It was said again
 * here, in a live review, after three of them had accumulated anyway:
 * "Info texte sollen immer in i infobubbles!"
 *
 * Nothing catches this by itself. A hint printed as a paragraph compiles, tests
 * green, translates fine and looks deliberate in a diff - it is one `<p>` among
 * many, and the only symptom is a page that reads as a manual. So the guard is
 * the source itself: a translation key whose name says it is an explanation may
 * only be used as a PROP.
 */

const SRC = join(import.meta.dirname, '..')

/** Every .tsx under src, which is where JSX lives. */
function screens(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...screens(path))
    } else if (name.endsWith('.tsx')) {
      out.push(path)
    }
  }
  return out
}

/**
 * The props an explanation is allowed to arrive in.
 *
 * `hint` and `tip` are the two bubbles; `message` is a dialog's own sentence,
 * which is the body of a window rather than prose beside a control; `title` is
 * the second line inside a button's bubble.
 */
const CARRIERS = new Set(['hint', 'tip', 'title', 'message', 'label', 'placeholder'])

/**
 * Which prop, if any, this expression is the value of.
 *
 * A real scanner rather than a pattern, because the interesting cases are
 * exactly the ones a pattern gets wrong: an explanation may sit inside a
 * ternary (`tip={a ? t('oneHint') : t('otherHint')}`) or a template, so the
 * enclosing brace has to be FOUND rather than assumed to be the nearest one to
 * the left. Walk back counting braces, brackets and parentheses; the first
 * opening brace that nothing closes is the JSX expression container, and what
 * stands before it says whether this is a prop or a page.
 */
export function propAround(source: string, at: number): string | null {
  let depth = 0
  for (let i = at; i >= 0; i--) {
    const c = source[i]
    if (c === '}' || c === ')' || c === ']') depth++
    else if (c === '(' || c === '[') depth--
    else if (c === '{') {
      if (depth === 0) {
        // Found the container. Anything but `name=` in front of it means this
        // expression is being rendered rather than handed over.
        const before = source.slice(0, i).trimEnd()
        if (!before.endsWith('=')) return null
        const name = /([A-Za-z][A-Za-z0-9]*)\s*=$/.exec(before)
        return name ? name[1] : null
      }
      depth--
    }
  }
  return null
}

/** Where every explanation key is read, with the file and the key. */
function usages(): { file: string; key: string; prop: string | null }[] {
  const found: { file: string; key: string; prop: string | null }[] = []
  for (const file of screens(SRC)) {
    if (file.endsWith('.test.tsx')) continue
    const source = readFileSync(file, 'utf8')
    // Keys whose NAME says they explain something: `edit.quietHint`,
    // `direction.hint`. The name is the contract; a key called `...Hint` that is
    // not an explanation is misnamed, which this would also catch.
    const pattern = /t\(\s*'([A-Za-z0-9.]*(?:Hint|\.hint))'/g
    for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
      found.push({ file: file.slice(SRC.length + 1), key: m[1], prop: propAround(source, m.index) })
    }
  }
  return found
}

describe('every explanation', () => {
  it('is handed to a bubble rather than printed on the page', () => {
    const printed = usages().filter((u) => u.prop === null || !CARRIERS.has(u.prop))
    expect(
      printed.map((u) => `${u.file}: ${u.key}${u.prop ? ` in ${u.prop}=` : ' as page text'}`),
      'an explanation belongs in an info bubble, not in a paragraph',
    ).toEqual([])
  })

  it('is actually read somewhere', () => {
    // The scan finding nothing would make the test above pass for ever, which is
    // the failure mode a source guard has and a unit test does not.
    expect(usages().length).toBeGreaterThan(15)
  })
})

describe('the scanner', () => {
  it('tells a prop from a page', () => {
    expect(propAround("<Field hint={t('a.bHint')}>", "<Field hint={t(".length - 3)).toBe('hint')
    expect(propAround("<p>{t('a.bHint')}</p>", "<p>{t(".length - 3)).toBe(null)
  })

  it('finds the container through a ternary', () => {
    const line = "<InfoBubble tip={on ? t('a.oneHint') : t('a.twoHint')} />"
    expect(propAround(line, line.indexOf("t('a.twoHint'"))).toBe('tip')
  })

  it('is not fooled by a brace inside the expression', () => {
    const line = "<Card hint={t('a.bHint', { count: 1 })} />"
    expect(propAround(line, line.indexOf("t('a.bHint'"))).toBe('hint')
  })
})
