import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The browser hands out navigator.clipboard only in a secure context, and the
// container is mostly opened over plain http on the local network. A button
// that writes to it directly does nothing there.

const src = fileURLToPath(new URL('..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('copying to the clipboard', () => {
  it('goes through copyText everywhere, so it works over plain http too', () => {
    const direct = sources(src).filter((path) => /navigator\.clipboard\??\.writeText/.test(readFileSync(path, 'utf8')))
    expect(direct.map((path) => path.slice(src.length))).toEqual([])
  })
})
