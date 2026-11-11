import { describe, expect, it } from 'vitest'
import { labelInside } from './signIn'

describe('labelInside', () => {
  it('writes the label into an empty field as its placeholder', () => {
    const field = { placeholder: '' }
    expect(labelInside(field, 'Name')).toBe(true)
    expect(field.placeholder).toBe('Name')
  })

  it('leaves a placeholder of the field its own and keeps the label above', () => {
    const field = { placeholder: 'XXXX-XXXX-XXXX' }
    expect(labelInside(field, 'Recovery code')).toBe(false)
    expect(field.placeholder).toBe('XXXX-XXXX-XXXX')
  })

  it('keeps the label above a field with a hint, where the hint stands', () => {
    const field = { placeholder: '' }
    expect(labelInside(field, 'Code', 'From your authenticator app')).toBe(false)
    expect(field.placeholder).toBe('')
  })

  it('keeps the label above a field that is not there yet', () => {
    expect(labelInside(null, 'Password')).toBe(false)
  })

  it('follows a new language in a label it wrote', () => {
    const field = { placeholder: '' }
    labelInside(field, 'Password')
    expect(labelInside(field, 'Passwort', undefined, 'Password')).toBe(true)
    expect(field.placeholder).toBe('Passwort')
  })
})
