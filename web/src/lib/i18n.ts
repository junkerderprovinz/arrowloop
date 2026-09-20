// Translation. English and German are bundled as the sources; every other
// language is its own chunk, fetched when chosen. English stays bundled because
// it is the fallback behind every missing key.

import type { Translate } from './i18n.data'
import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'


// Vite resolves the pattern at build time, so adding a language is adding a file.
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
    // Offline, or a stale page asking for a hash that no longer exists:
    // English is better than a blank page.
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

// The tables live in i18n.data.ts, which the Android app shares.
export { en, de, LANGUAGES, SUPPORTED, isRtl }
export type { Language, TranslationKey, Translations }


const DEFAULT_CODE = 'en'
const STORAGE_KEY = 'arrowloop.lang'

/**
 * The language in use, resolved from the browser when nobody has chosen one.
 * The picker has no "automatic" entry, so it always shows the language that is
 * actually running.
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

// Defined in i18n.data.ts, so plain functions that take a translator can be
// imported by a bundler that cannot parse this file's import.meta.glob.
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
    // Two quick switches race, and the last one has to win.
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
      // With storage off the choice is forgotten on reload, but still applies.
    }
    document.documentElement.setAttribute('lang', code)
    document.documentElement.setAttribute('dir', isRtl(code) ? 'rtl' : 'ltr')
    // Fetch first, so the switch does not flash English.
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
 * Render a reason in the reader's language. The engine sends a code and its
 * English sentence; a code this build does not know falls back to that
 * sentence. Side names in the values are translated too.
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
    // A code missing from en comes from a newer engine.
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
