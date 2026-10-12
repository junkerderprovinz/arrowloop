import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The design language picks rows with a round mark and switches settings with
// a switch, so a native checkbox anywhere is a control that slipped through.
const SRC = fileURLToPath(new URL('..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sources(path)
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [path] : []
  })
}

describe('the interface', () => {
  it('draws no native checkbox', () => {
    const found = sources(SRC).filter((file) => /type=["']checkbox["']/.test(readFileSync(file, 'utf8')))
    expect(found).toEqual([])
  })
})
