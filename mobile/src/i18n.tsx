import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as Localization from "expo-localization";
import { I18nManager } from "react-native";
import {
  de,
  en,
  isRtl,
  LANGUAGES,
  SUPPORTED,
  type Language,
  type TranslationKey,
  type Translations,
} from "../../web/src/lib/i18n.data";
import { locales } from "./locales";
import { settings } from "./settings";

export type { Language, TranslationKey };
export { LANGUAGES, isRtl };

// The sentences come from web/src/lib/i18n.data.ts, shared with the container.
// The chosen language is kept in the engine's settings so the phone and the
// desktop agree; the phone's locale is only the fallback for a fresh install.

/** The translate function, typed so a plain helper can take one. */
export type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18n {
  t: T;
  lang: string;
  setLang: (code: string) => void;
  rtl: boolean;
}

const Ctx = createContext<I18n | null>(null);

function fromDevice(): string {
  for (const locale of Localization.getLocales()) {
    const short = locale.languageCode?.toLowerCase();
    if (short && SUPPORTED.includes(short)) return short;
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(fromDevice);

  useEffect(() => {
    settings
      .read()
      .then((s) => {
        if (s.language && SUPPORTED.includes(s.language)) setLangState(s.language);
      })
      .catch(() => {
        // On a cold start the engine may not answer yet; the device's
        // language stays until the next read.
      });
  }, []);

  const setLang = useCallback((code: string) => {
    setLangState(code);
    void settings.write({ language: code }).catch(() => {});
  }, []);

  const table = useMemo(() => {
    // A key missing from an unfinished table falls back to English.
    const chosen: Partial<Translations> =
      lang === "en" ? en : lang === "de" ? de : (locales[lang] ?? {});
    return { ...en, ...chosen } as Translations;
  }, [lang]);

  const rtl = isRtl(lang);

  // Right to left is a layout direction that React Native applies to every
  // row and margin, so it is set once here.
  useEffect(() => {
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
  }, [rtl]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      let text = table[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    },
    [table],
  );

  return <Ctx.Provider value={{ t, lang, setLang, rtl }}>{children}</Ctx.Provider>;
}

export function useT(): I18n {
  const value = useContext(Ctx);
  if (!value) throw new Error("useT outside I18nProvider");
  return value;
}
