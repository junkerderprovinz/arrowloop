import { describe, expect, it } from 'vitest'

import { actionName } from './actionName'

describe('a planned action', () => {
  it('shows the name as the side holding the file spells it', () => {
    expect(actionName({ path: 'garden plan.pdf', left: { path: 'Garden plan.pdf' } })).toBe('Garden plan.pdf')
  })

  it('takes the other side when only that one holds the file', () => {
    expect(actionName({ path: 'notes.md', right: { path: 'Notes.md' } })).toBe('Notes.md')
  })

  it('falls back to the key when neither side has a version', () => {
    expect(actionName({ path: 'photos' })).toBe('photos')
  })
})
