// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { applyStoredLanguage } from './i18n'

const KEY = 'arrowloop.lang'

function openAt(search: string) {
  window.history.replaceState(null, '', '/' + search)
}

describe("the desktop installer's language", () => {
  afterEach(() => {
    localStorage.clear()
    openAt('')
  })

  it('is the first language and is kept as a choice', () => {
    openAt('?lang=de')
    applyStoredLanguage()
    expect(document.documentElement.lang).toBe('de')
    expect(localStorage.getItem(KEY)).toBe('de')
  })

  it('gives way to a language picked in the app', () => {
    localStorage.setItem(KEY, 'fr')
    openAt('?lang=de')
    applyStoredLanguage()
    expect(document.documentElement.lang).toBe('fr')
    expect(localStorage.getItem(KEY)).toBe('fr')
  })

  it('is ignored when the app does not speak it', () => {
    openAt('?view=activity&lang=xx')
    applyStoredLanguage()
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('turns a right-to-left page round', () => {
    openAt('?view=activity&lang=ar')
    applyStoredLanguage()
    expect(document.documentElement.dir).toBe('rtl')
  })
})
