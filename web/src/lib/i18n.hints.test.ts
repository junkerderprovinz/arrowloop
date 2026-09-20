import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * An explanation belongs in a bubble, not printed on the page, as the design
 * language requires. A translation key whose name says it is an explanation may
 * only be used as a prop.
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
 * The props an explanation may arrive in. `hint` and `tip` are the bubbles,
 * `message` is a dialog's body and `title` the second line in a button's bubble.
 */
const CARRIERS = new Set(['hint', 'tip', 'title', 'message', 'label', 'placeholder'])

/**
 * Which prop, if any, this expression is the value of.
 *
 * An explanation may sit inside a ternary or a template, so this walks back
 * counting brackets: the first opening brace nothing closes is the JSX
 * expression container, and what stands before it names the prop.
 */
export function propAround(source: string, at: number): string | null {
  let depth = 0
  for (let i = at; i >= 0; i--) {
    const c = source[i]
    if (c === '}' || c === ')' || c === ']') depth++
    else if (c === '(' || c === '[') depth--
    else if (c === '{') {
      if (depth === 0) {
        // Without `name=` in front, the expression is rendered as page text.
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
    // Keys named as explanations, such as `edit.quietHint` or `direction.hint`.
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
    // A scan that found nothing would let the test above pass.
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
