import { describe, expect, it } from 'vitest'

import { nameAndKind } from './optionHint'

describe('a provider name on two lines', () => {
  it('puts what the provider is under its name', () => {
    expect(nameAndKind('SMB / Windows-Freigabe')).toEqual({ name: 'SMB', sub: 'Windows-Freigabe' })
  })

  it('leaves a name without a kind on one line', () => {
    expect(nameAndKind('Dropbox')).toEqual({ name: 'Dropbox' })
  })

  it('does not split a name that only contains a slash', () => {
    expect(nameAndKind('Uložto/Files')).toEqual({ name: 'Uložto/Files' })
  })
})
