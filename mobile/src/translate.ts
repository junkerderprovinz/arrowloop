import { en, type Translations } from "../../web/src/lib/i18n.data.ts";
import type { T } from "./i18n";

/**
 * The translate function over one language's table. A key missing from an
 * unfinished table falls back to English, and one missing from English comes
 * back as itself.
 */
export function translator(chosen: Partial<Translations>): T {
  const table = { ...en, ...chosen } as Translations;
  return (key, vars) => {
    let text = table[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  };
}
