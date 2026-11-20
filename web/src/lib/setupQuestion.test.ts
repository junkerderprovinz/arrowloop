import { describe, expect, it } from 'vitest'

import { en } from './i18n.data'
import { oneTimeCode, questionHint, questionLabel, typedAnswer } from './setupQuestion'

const drives = { name: 'config_driveid', choices: [{ value: 'me', help: 'Personal' }, { value: 'team', help: 'Team' }] }
const code = { name: 'config_2fa', choices: [] }

describe('a question from a backend setup', () => {
  it('is picked from a list where the setup offers choices', () => {
    expect(typedAnswer(drives)).toBe(false)
    expect(en[questionLabel(drives)]).toBe('Drive')
    expect(en[questionHint(drives)]).toMatch(/Choose/)
  })

  it('asks for a two-factor code to be typed in', () => {
    expect(typedAnswer(code)).toBe(true)
    expect(oneTimeCode(code)).toBe(true)
    expect(en[questionLabel(code)]).toBe('Two-factor code')
    expect(en[questionHint(code)]).toMatch(/authenticator app/)
  })

  it('names an unknown typed question as an answer rather than a choice', () => {
    const other = { name: 'config_site', choices: [] }
    expect(oneTimeCode(other)).toBe(false)
    expect(en[questionLabel(other)]).toBe('Answer')
    expect(en[questionHint(other)]).not.toMatch(/Choose/)
  })
})
