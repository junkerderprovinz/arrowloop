// ---------------------------------------------------------------------------
// One control, one tooltip mechanism.
//
// GlimStone 1.7.5 wrote the rule after it was reported here: the direction
// button opened TWO hover bubbles, the app's own and the operating system's,
// one a moment after the other, at different places, in different fonts. jdp:
// "der seitenwecheselbutton hat zwei mouseover infofenster."
//
// It was never one button. Seven elements in this app carried `title` and
// `data-tip` together, each of them correct in isolation: `data-tip` is what
// the app's bubble reads, `title` is the habit. The delegated auto-upgrade the
// language describes cannot rescue this pairing, because there is nothing left
// to upgrade - `data-tip` is already there and the `title` simply also paints.
//
// So it is a grep, which is what the rule says it should be. A REGRESSION here
// is invisible in review and obvious on screen, which is exactly the shape of
// defect a cheap guard is for.
//
// THE TAG SCANNER IS THE WHOLE FILE, and the first version of it was blind.
// A regex of `<[A-Za-z][^>]*?>` stops at the first `>` character, and in JSX
// that is almost never the end of the tag: an `onClick={() => ...}` handler
// puts a `>` inside the attribute list, so the "tag" ended before the
// attributes that matter. Written that way this file passed while the exact
// defect it was written for was reintroduced two lines below the handler.
// Found by breaking it on purpose, which is the only reason it is not still
// reporting green.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

/**
 * The opening tags in a file, each as one flat string.
 *
 * Scanned rather than matched, because a JSX tag's attribute list can contain
 * every character that would end a regex: `>` inside an arrow function, `{}`
 * inside an expression, quotes inside a string, braces inside a nested object.
 * So this walks the text and closes a tag only on a `>` that is outside every
 * brace and every quote.
 *
 * Attributes are gathered per TAG rather than per file, or a component with a
 * `title` prop on one element and a `data-tip` on another fifty lines away
 * would be reported for a defect it does not have.
 */
export function openingTags(source: string): string[] {
  const out: string[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<') continue
    if (!/[A-Za-z]/.test(source[i + 1] ?? '')) continue
    let depth = 0
    let quote = ''
    let j = i + 1
    for (; j < source.length; j++) {
      const c = source[j]
      if (quote) {
        if (c === quote && source[j - 1] !== '\\') quote = ''
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = c
        continue
      }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
      // A `<` at depth zero means the scan started on something that was not a
      // tag after all (a comparison, a generic). Give up on this one rather
      // than swallowing the rest of the file into a single "tag".
      else if (c === '<' && depth === 0) {
        j = -1
        break
      }
    }
    if (j > 0 && j < source.length) {
      out.push(source.slice(i, j + 1))
      i = j
    }
  }
  return out
}

describe('one control, one tooltip', () => {
  it('never puts title and data-tip on the same element', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const tag of openingTags(source)) {
        // `title=` has to be its own attribute: `confirmTitle=` and
        // `data-title=` are different props and neither paints a balloon.
        const hasTitle = /(^|\s)title=/.test(tag)
        const hasTip = /(^|\s)data-tip=/.test(tag)
        if (hasTitle && hasTip) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`)
        }
      }
    }
    expect(
      offenders,
      `these elements open two hover bubbles at once, the app's and the OS's:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('reads a whole tag, including everything after an arrow function', () => {
    // The regression test for this file's own first version. A `>` inside an
    // event handler used to end the tag, so every attribute written below a
    // handler was invisible and the scan reported green on a real defect.
    const tag = openingTags(
      [
        '<button',
        '  type="button"',
        '  onClick={() => onChange(next(direction))}',
        '  title={tip}',
        '  data-tip={tip}',
        '>',
      ].join('\n'),
    )
    expect(tag).toHaveLength(1)
    expect(tag[0]).toContain('title={tip}')
    expect(tag[0]).toContain('data-tip={tip}')
    expect(/(^|\s)title=/.test(tag[0]) && /(^|\s)data-tip=/.test(tag[0])).toBe(true)
  })

  it('does not fire on the two shapes that are fine', () => {
    const alone = openingTags('<button title={tip} onClick={() => go()}>')
    expect(alone).toHaveLength(1)
    expect(/(^|\s)data-tip=/.test(alone[0])).toBe(false)

    const named = openingTags('<Dialog confirmTitle={x} data-tip={y}>')
    expect(named).toHaveLength(1)
    expect(/(^|\s)title=/.test(named[0])).toBe(false)
  })

  it('keeps two separate elements separate', () => {
    // The false positive that would get this guard switched off: one component
    // with a title on one element and a data-tip on another.
    const tags = openingTags('<span title={a}>x</span>\n<span data-tip={b}>y</span>')
    // Two, not four: a closing tag starts `</`, and the scanner only opens on a
    // letter, so it never sees one.
    expect(tags).toHaveLength(2)
    expect(tags.filter((tg) => /(^|\s)title=/.test(tg) && /(^|\s)data-tip=/.test(tg))).toEqual([])
  })
})
