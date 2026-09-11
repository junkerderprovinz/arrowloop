// Translation, forty-two languages, with English and German inline as the two
// sources of truth.
//
// The other forty arrive one chunk at a time. Bundling them all would put
// forty-one languages nobody is reading into the download of every visitor, and
// translations are the one part of an interface where that waste is certain
// rather than likely. English stays static because it is the fallback behind
// every missing key, and a fallback that has to be fetched is not a fallback.

import type { Translate } from './i18n.data'
import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'


// import.meta.glob rather than forty hand-written arrow functions: Vite
// resolves the pattern at build time, so adding a language is adding a file,
// and a map that has to be edited in step is a map that will not be.
const localeChunks = import.meta.glob<{ default: Partial<Translations> }>('./locales/*.ts')

const loaded: Record<string, Partial<Translations>> = {}

/** The table for one language, fetching its chunk the first time. */
export async function loadLocale(code: string): Promise<Partial<Translations>> {
  if (loaded[code]) return loaded[code]
  const chunk = localeChunks[`./locales/${code}.ts`]
  if (!chunk) return {}
  try {
    const mod = await chunk()
    loaded[code] = mod.default
    return mod.default
  } catch {
    // A chunk that never arrives, because the machine is offline or a stale
    // page is asking for a hash that no longer exists, must not take the
    // interface down with it. English is a worse experience than the language
    // somebody chose and a far better one than a blank page.
    return {}
  }
}
import {
  en,
  de,
  LANGUAGES,
  SUPPORTED,
  isRtl,
  type Language,
  type TranslationKey,
  type Translations,
} from './i18n.data'

// Re-exported so every existing import of these from './i18n' keeps working.
// The table itself lives in i18n.data.ts, which the Android app shares - see
// the note at the top of that file.
export { en, de, LANGUAGES, SUPPORTED, isRtl }
export type { Language, TranslationKey, Translations }


const DEFAULT_CODE = 'en'
const STORAGE_KEY = 'arrowloop.lang'

/**
 * The language in use, resolved from the browser when nobody has chosen one.
 *
 * There is deliberately no "automatic" entry in the picker. That entry looks
 * like an option and is an excuse: it fails to answer the only question
 * somebody opens the list to ask, which is which language is running right now.
 * The browser's preference is resolved here and the real language it lands on
 * is what the list shows as selected.
 */
function resolveCode(raw: string | null): string {
  if (raw && SUPPORTED.includes(raw)) return raw
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const short = candidate.slice(0, 2).toLowerCase()
    if (SUPPORTED.includes(short)) return short
  }
  return DEFAULT_CODE
}

function storedCode(): string {
  try {
    return resolveCode(localStorage.getItem(STORAGE_KEY))
  } catch {
    return resolveCode(null)
  }
}

/** Set the document language before the first render, so a right-to-left page
 *  does not arrive the wrong way round and swap. */
export function applyStoredLanguage(): void {
  const code = storedCode()
  document.documentElement.setAttribute('lang', code)
  document.documentElement.setAttribute('dir', isRtl(code) ? 'rtl' : 'ltr')
}

export const locales: Record<string, Partial<Translations>> = { en, de }

/**
 * The translate function, named so a plain function can take one.
 *
 * A helper that turns data into a sentence needs `t` and nothing else from the
 * context, and it should not have to be a component to say so.
 */
// Defined beside the table so plain functions that take a translator - the
// cadence words, the reason codes - can be imported by a bundler that cannot
// parse this file's import.meta.glob. Re-exported here so nothing else moves.
export type { Translate }

export interface I18nContextValue {
  lang: string
  setLanguage: (code: string) => void
  t: Translate
  languages: Language[]
}

/** Filled in with the placeholder values a sentence needs. */
function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_CODE,
  setLanguage: () => undefined,
  t: (key, vars) => fill(en[key] ?? key, vars),
  languages: LANGUAGES,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<string>(storedCode)
  const [table, setTable] = useState<Partial<Translations>>(() => locales[storedCode()] ?? en)

  useEffect(() => {
    if (locales[lang]) {
      setTable(locales[lang])
      return
    }
    let current = true
    // A flag rather than an abort: two quick switches race, and the LAST one
    // has to win whichever chunk happens to land first.
    void loadLocale(lang).then((next) => {
      if (current) setTable(next)
    })
    return () => {
      current = false
    }
  }, [lang])

  const setLanguage = useCallback((code: string) => {
    if (!SUPPORTED.includes(code)) return
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // A browser with storage turned off forgets the choice on reload, which
      // is worth strictly less than refusing to change language at all.
    }
    document.documentElement.setAttribute('lang', code)
    document.documentElement.setAttribute('dir', isRtl(code) ? 'rtl' : 'ltr')
    // Fetch before the state change, so switching shows the new language
    // rather than a beat of English on the way to it.
    void loadLocale(code).then(() => setLangState(code))
  }, [])

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      fill(table[key] ?? en[key] ?? key, vars),
    [table],
  )

  return createElement(I18nContext.Provider, { value: { lang, setLanguage, t, languages: LANGUAGES } }, children)
}

export function useT(): I18nContextValue {
  return useContext(I18nContext)
}

/** One reason from the engine: a code with its values, and the English sentence. */
export interface Reason {
  code: string
  vars?: Record<string, string>
  text: string
}

/**
 * Render a reason in the reader's language.
 *
 * The engine sends both halves on purpose. Translating on its side would mean
 * knowing the reader's language on every run, and would leave the log written
 * in whichever language somebody last asked a question in. So the code is
 * translated here, and a code this build has never heard of falls back to the
 * engine's own sentence rather than to the code itself: an explanation in the
 * wrong language is worth more than a dotted identifier.
 *
 * The values are translated too. A sentence that reads "geändert on the left"
 * is not translated, it is half translated, which is the more annoying half.
 */
export function useReason(): (reason?: Reason | null) => string {
  const { t } = useT()
  return (reason) => {
    if (!reason) return ''
    const key = `reason.${reason.code}` as TranslationKey
    const vars: Record<string, string> = {}
    for (const [name, value] of Object.entries(reason.vars ?? {})) {
      vars[name] = name === 'side' || name === 'other' ? translateSide(t, value) : value
    }
    // en carries every code this build knows. Anything else is a newer engine
    // talking to an older interface, and its own sentence is the better answer.
    if (!(key in en)) return reason.text
    return t(key, vars)
  }
}

/** A side named by the engine, in the reader's language. */
export function translateSide(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  side: string,
): string {
  if (side === 'left') return t('side.left')
  if (side === 'right') return t('side.right')
  return side
}
