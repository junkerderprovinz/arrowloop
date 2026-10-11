import { describe, expect, it } from 'vitest'

import { ApiError } from './api'
import { errorText } from './errorText'
import { de } from './i18n'

const t = (key: string) => de[key as keyof typeof de] ?? key

describe('what a failed call tells the reader', () => {
  it('words the missing password in the reader’s language', () => {
    expect(errorText(t, new ApiError('set a password first', 403, 'password-not-set'))).toBe(de['error.passwordNotSet'])
  })

  it('passes any other error on as the server wrote it', () => {
    expect(errorText(t, new ApiError('no remote called "home"', 404))).toBe('no remote called "home"')
  })
})
