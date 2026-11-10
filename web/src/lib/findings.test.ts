import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { en } from './i18n.data'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The codes and English templates of a Go package's findingText map. */
function engineFindings(file: string): Record<string, string> {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const table = source.match(/var findingText = map\[string\]string\{([\s\S]*?)\n\}/)
  if (!table) throw new Error(`no findingText in ${file}`)
  return Object.fromEntries([...table[1].matchAll(/"(\w+)":\s+"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]))
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe.each(['internal/precheck/precheck.go', 'internal/verify/verify.go'])('the findings of %s', (file) => {
  const findings = engineFindings(file)

  it('are read from the engine', () => {
    expect(Object.keys(findings).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(findings))('%s has a translation with the same placeholders', (code, text) => {
    const key = `finding.${code}` as keyof typeof en
    expect(en[key], `missing ${key}`).toBeDefined()
    expect(placeholders(en[key])).toEqual(placeholders(text))
  })
})
