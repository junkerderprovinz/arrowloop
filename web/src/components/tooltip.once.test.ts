// One control, one tooltip mechanism (GlimStone 1.7.5). An element carrying
// both `title` and `data-tip` opens two hover bubbles, the app's and the
// operating system's, and the language's auto-upgrade cannot help because
// `data-tip` is already there.
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
 * The opening tags in a file, each as one flat string. Scanned rather than
 * matched, since a JSX attribute list can hold a `>` inside an arrow function;
 * a tag closes only on a `>` outside every brace and quote.
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
      // A `<` at depth zero means this was a comparison or a generic, not a tag.
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
        // `title=` must stand alone: `confirmTitle=` and `data-title=` paint
        // no balloon.
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
    const tags = openingTags('<span title={a}>x</span>\n<span data-tip={b}>y</span>')
    // The scanner only opens on a letter, so closing tags are not counted.
    expect(tags).toHaveLength(2)
    expect(tags.filter((tg) => /(^|\s)title=/.test(tg) && /(^|\s)data-tip=/.test(tg))).toEqual([])
  })
})
