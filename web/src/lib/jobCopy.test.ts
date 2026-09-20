import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { jobCopy, type CopyableJob } from './jobCopy.data'

describe('jobCopy', () => {
  it('names the first copy without a number', () => {
    const copy = jobCopy({ name: 'Fotos' }, ['Fotos'], 'Kopie', 'Neuer Auftrag')
    expect(copy.name).toBe('Fotos-Kopie')
  })

  it('counts up from 2, so a lone copy never carries a 1', () => {
    const taken = ['Fotos', 'Fotos-Kopie', 'Fotos-Kopie-2']
    expect(jobCopy({ name: 'Fotos' }, taken, 'Kopie', 'x').name).toBe('Fotos-Kopie-3')
  })

  it('gives the copy its own state database', () => {
    const copy = jobCopy({ name: 'Fotos', state: 'state/Fotos.db' }, [], 'Kopie', 'x')
    expect(copy.state).toBe('state/Fotos-Kopie.db')
  })

  // Running beside its original, the copy would undo the original's work.
  it('arrives held, whatever the original was', () => {
    const on: CopyableJob = { name: 'a', disabled: false }
    const unsaid: CopyableJob = { name: 'a' }
    expect(jobCopy(on, [], 'Kopie', 'x').disabled).toBe(true)
    expect(jobCopy(unsaid, [], 'Kopie', 'x').disabled).toBe(true)
  })

  it('falls back to the translated name when the original has none', () => {
    const nameless: CopyableJob = {}
    expect(jobCopy(nameless, [], 'Kopie', 'Neuer Auftrag').name).toBe('Neuer Auftrag-Kopie')
  })

  it('carries everything else across untouched', () => {
    const source = { name: 'a', left: '/x', right: 'Ziel:y', schedule: '0 3 * * *' }
    const copy = jobCopy(source, [], 'Kopie', 'x')
    expect(copy.left).toBe('/x')
    expect(copy.right).toBe('Ziel:y')
    expect(copy.schedule).toBe('0 3 * * *')
  })

  // Read from the source, since no renderer here reaches the phone. A surface
  // that imports this module cannot grow its own copy of the rule.
  it.each([
    ['the container', 'src/pages/Editor.tsx', "from '../lib/jobCopy.data'"],
    ['the app', '../mobile/src/screens/Jobs.tsx', 'from "../../../web/src/lib/jobCopy.data"'],
  ])('%s duplicates through this module', (_who, file, importLine) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    expect(source).toContain('jobCopy')
    expect(source).toContain(importLine)
    // Nor a naming rule of its own.
    expect(source).not.toMatch(/\$\{base\}-\$\{n\}/)
  })
})
