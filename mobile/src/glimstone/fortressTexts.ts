// Every table at once, for an app that picks its language at run time. An app
// with one language imports its own module from fortressLocales/ instead.

import type { FortressText } from "./fortressText.ts";
import { en } from "./fortressLocales/en.ts";
import { de } from "./fortressLocales/de.ts";
import { ar } from "./fortressLocales/ar.ts";
import { bg } from "./fortressLocales/bg.ts";
import { ca } from "./fortressLocales/ca.ts";
import { cs } from "./fortressLocales/cs.ts";
import { da } from "./fortressLocales/da.ts";
import { el } from "./fortressLocales/el.ts";
import { es } from "./fortressLocales/es.ts";
import { et } from "./fortressLocales/et.ts";
import { eu } from "./fortressLocales/eu.ts";
import { fa } from "./fortressLocales/fa.ts";
import { fi } from "./fortressLocales/fi.ts";
import { fr } from "./fortressLocales/fr.ts";
import { gl } from "./fortressLocales/gl.ts";
import { he } from "./fortressLocales/he.ts";
import { hi } from "./fortressLocales/hi.ts";
import { hr } from "./fortressLocales/hr.ts";
import { hu } from "./fortressLocales/hu.ts";
import { id } from "./fortressLocales/id.ts";
import { is } from "./fortressLocales/is.ts";
import { it } from "./fortressLocales/it.ts";
import { ja } from "./fortressLocales/ja.ts";
import { ko } from "./fortressLocales/ko.ts";
import { lt } from "./fortressLocales/lt.ts";
import { lv } from "./fortressLocales/lv.ts";
import { ms } from "./fortressLocales/ms.ts";
import { nl } from "./fortressLocales/nl.ts";
import { no } from "./fortressLocales/no.ts";
import { pl } from "./fortressLocales/pl.ts";
import { pt } from "./fortressLocales/pt.ts";
import { ro } from "./fortressLocales/ro.ts";
import { ru } from "./fortressLocales/ru.ts";
import { sk } from "./fortressLocales/sk.ts";
import { sl } from "./fortressLocales/sl.ts";
import { sr } from "./fortressLocales/sr.ts";
import { sv } from "./fortressLocales/sv.ts";
import { th } from "./fortressLocales/th.ts";
import { tr } from "./fortressLocales/tr.ts";
import { uk } from "./fortressLocales/uk.ts";
import { vi } from "./fortressLocales/vi.ts";
import { zh } from "./fortressLocales/zh.ts";

const TEXTS: Record<string, FortressText> = { en, de, ar, bg, ca, cs, da, el, es, et, eu, fa, fi, fr, gl, he, hi, hr, hu, id, is, it, ja, ko, lt, lv, ms, nl, no, pl, pt, ro, ru, sk, sl, sr, sv, th, tr, uk, vi, zh };

/** The languages GlimStone carries the fortress in, the same as the glossary's. */
export const FORTRESS_LANGUAGES = Object.keys(TEXTS);

/** The table for a language tag such as `pt-BR`: its own, its base language's, or English. */
export function fortressText(lang: string): FortressText {
  const tag = lang.toLowerCase();
  return TEXTS[tag] ?? TEXTS[tag.split(/[-_]/)[0]!] ?? en;
}
