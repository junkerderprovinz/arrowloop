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

/**
 * Forty-two languages, from the SAME table the container uses.
 *
 * `web/src/lib/i18n.data.ts` holds every sentence, and this reads it. The web
 * app's own i18n.ts carries a React context and Vite's `import.meta.glob`,
 * neither of which Metro can parse - so the data was split out rather than
 * copied. A phone showing a different German from the container is the kind of
 * drift nobody reports and everybody notices.
 *
 * The LANGUAGE ITSELF lives in the engine's settings, not in this app. Somebody
 * who picks Czech at a desk expects Czech on the phone; two independent
 * settings would be two places to change it and one of them always forgotten.
 * The phone's own locale is the fallback for a fresh install that has never
 * been told.
 */

/** The translate function, named so a plain helper can take one without
 *  having to be a component to say so. */
export type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18n {
  t: T;
  lang: string;
  setLang: (code: string) => void;
  rtl: boolean;
}

const Ctx = createContext<I18n | null>(null);

/** The phone's own language, when nothing has been chosen. */
function fromDevice(): string {
  for (const locale of Localization.getLocales()) {
    const short = locale.languageCode?.toLowerCase();
    if (short && SUPPORTED.includes(short)) return short;
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(fromDevice);

  // The engine's settings win over the device, once they have been read. Until
  // then the device's language is on screen rather than English, because a
  // flash of the wrong language is worse than a moment of the right one.
  useEffect(() => {
    settings
      .read()
      .then((s) => {
        if (s.language && SUPPORTED.includes(s.language)) setLangState(s.language);
      })
      .catch(() => {
        // The engine not answering yet is the ordinary case on a cold start.
        // The device's language stays, and the next read corrects it.
      });
  }, []);

  const setLang = useCallback((code: string) => {
    setLangState(code);
    void settings.write({ language: code }).catch(() => {});
  }, []);

  const table = useMemo(() => {
    // English underneath everything, always. It is the fallback behind every
    // missing key, and a language whose table is half finished should show the
    // English sentence rather than the key itself.
    const chosen: Partial<Translations> =
      lang === "en" ? en : lang === "de" ? de : (locales[lang] ?? {});
    return { ...en, ...chosen } as Translations;
  }, [lang]);

  const rtl = isRtl(lang);

  // Right to left is a LAYOUT direction, not a text style: React Native flips
  // every row, every margin and every icon position for it. Told once, here,
  // rather than by each screen remembering.
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
