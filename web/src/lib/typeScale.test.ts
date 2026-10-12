import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every text is set in one of GlimStone's five sizes by its role name:
 * text-status, text-title, text-body, text-subline and text-meta. Tailwind's
 * own steps and arbitrary sizes are the drift the scale exists to stop. The
 * copies in lib/glimstone are the design language's own and are checked
 * there. This reads source; it does not render.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

/** The sizes the scale leaves out on purpose, each allowed in one file. */
const OUTSIDE: Record<string, string[]> = {
  // The wordmark, and the rail rows at the sidebar's own 15px.
  'components/Sidebar.tsx': ['text-xl', 'text-[15px]'],
  // A brand mark drawn at 1em, sized through the font size.
  'pages/Targets.tsx': ['text-[20px]'],
}

const OFF_SCALE =
  /\btext-(?:xs|sm|base|lg|[2-9]?xl|heading|dense|caption|\[[\d.]+(?:px|rem|em|%)?\])(?![\w-])/g

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'glimstone' || name === 'locales' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('the type scale', () => {
  it('holds the five sizes', () => {
    const tokens = readFileSync(join(SRC, 'tokens.css'), 'utf8')
    const size = (name: string) => tokens.match(new RegExp(`--text-${name}:\\s*([\\d.]+)rem`))?.[1]
    expect(['status', 'title', 'body', 'subline', 'meta'].map(size)).toEqual([
      '1.375',
      '1',
      '0.875',
      '0.8125',
      '0.75',
    ])
  })

  it('writes no size off the scale in a component', () => {
    const files = sources(SRC)
    expect(files.length).toBeGreaterThan(50)
    const found: string[] = []
    for (const path of files) {
      const name = path.slice(SRC.length).replace(/\\/g, '/').replace(/^\//, '')
      const text = readFileSync(path, 'utf8')
      for (const m of text.matchAll(OFF_SCALE)) {
        if (OUTSIDE[name]?.includes(m[0])) continue
        found.push(`${name}:${text.slice(0, m.index).split('\n').length} ${m[0]}`)
      }
    }
    expect(found).toEqual([])
  })

  it('sets no font size in the app stylesheet', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css.match(/font-size:[^;}]+/g) ?? []).toEqual([])
  })
})
