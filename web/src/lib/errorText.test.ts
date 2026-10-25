import { describe, expect, it } from 'vitest'

import { ApiError } from './api'
import { errorText } from './errorText'
import { de } from './i18n'

const t = (key: string, vars?: Record<string, string | number>) =>
  (de[key as keyof typeof de] ?? key).replace(/\{(\w+)\}/g, (all, name: string) => String(vars?.[name] ?? all))

describe('what a failed call tells the reader', () => {
  it('words the missing password in the reader’s language', () => {
    expect(errorText(t, new ApiError('set a password first', 403, 'password-not-set'))).toBe(de['error.passwordNotSet'])
  })

  it('names the jobs that keep a target from being deleted', () => {
    const refused = new ApiError('jobs still use backup: photos', 409, 'target-in-use', { jobs: 'photos, music' })
    expect(errorText(t, refused)).toContain('photos, music')
    expect(errorText(t, refused)).not.toContain('jobs still use')
  })

  it('passes any other error on as the server wrote it', () => {
    expect(errorText(t, new ApiError('no remote called "home"', 404))).toBe('no remote called "home"')
  })
})
