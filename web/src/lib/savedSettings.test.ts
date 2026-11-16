import { describe, expect, it } from 'vitest'

import { anySaved, settingsToSave } from './savedSettings'

describe('the settings a phone form saves', () => {
  const saved = [
    { key: 'root_folder_id', secret: false },
    { key: 'token', secret: true },
  ]

  it('clears a saved setting whose field was emptied', () => {
    expect(settingsToSave({ root_folder_id: '' }, saved)).toEqual({ root_folder_id: '' })
  })

  it('leaves out an empty field the target never had', () => {
    expect(settingsToSave({ drive_id: '', root_folder_id: 'common' }, [])).toEqual({ root_folder_id: 'common' })
  })

  it('keeps the saved secret when its field is left empty', () => {
    expect(settingsToSave({ token: '' }, saved)).toEqual({})
  })

  it('counts a field of spaces as empty', () => {
    expect(settingsToSave({ root_folder_id: '  ', drive_id: ' ' }, saved)).toEqual({ root_folder_id: '' })
  })
})

describe('the folded settings on the phone', () => {
  const others = ['root_folder_id', 'chunk_size']

  it('start open when the saved target has one of them set', () => {
    expect(anySaved([{ key: 'drive_id', value: '123456' }, { key: 'root_folder_id', value: 'common' }], others)).toBe(true)
  })

  it('start closed when none of them is set', () => {
    expect(anySaved([{ key: 'drive_id', value: '123456' }, { key: 'root_folder_id', value: '' }], others)).toBe(false)
    expect(anySaved([], others)).toBe(false)
  })
})
