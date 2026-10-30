import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A window's way out and its other answers are filled buttons (GlimStone rules
// 3 and 15). Every tone of GlimStone's Button has a fill, so a foot holds
// nothing but Button: a bare <button> or a link there, or a Button stripped of
// its ground, reads as a word beside the button it answers with.

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..')

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) found.push(path)
  }
  return found
}

/** Each `footer={…}` prop, with where it starts. */
function feet(text: string): [string, number][] {
  const out: [string, number][] = []
  for (const m of text.matchAll(/\bfooter=\{/g)) {
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) {
        out.push([text.slice(m.index, i + 1), m.index])
        break
      }
    }
  }
  return out
}

const UNFILLED = [/<button\b/, /<a\b/, /\bbg-(transparent|none)\b/]

describe('window feet', () => {
  it('reads the source at all', () => {
    const all = sourceFiles(src).flatMap((f) => feet(readFileSync(f, 'utf8')))
    expect(all.length).toBeGreaterThan(3)
  })

  it('fills every button in a window foot', () => {
    const hits: string[] = []
    for (const path of sourceFiles(src)) {
      const text = readFileSync(path, 'utf8')
      for (const [foot, at] of feet(text)) {
        for (const shape of UNFILLED) {
          const m = shape.exec(foot)
          if (!m) continue
          const line = text.slice(0, at + m.index).split('\n').length
          hits.push(`${path.slice(src.length + 1)}:${line} ${m[0]}`)
        }
      }
    }
    expect(hits).toEqual([])
  })
})
