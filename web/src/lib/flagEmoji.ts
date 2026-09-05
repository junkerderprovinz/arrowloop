// design-language.md, "The user-owned axes" > Language: a native <option>
// can only ever hold plain text - no image, no CSS background - so a "real"
// flag icon library forces a custom-built dropdown just to render it, which
// defeats the whole point of using a plain <select> for a dozens-of-entries
// language list. The regional-indicator emoji sequence needs nothing beyond
// string concatenation - macOS/Linux/iOS/Android render it as an actual
// flag glyph; Windows' own text font renders the same codepoints as a
// compact two-letter tag instead (a deliberate, long-standing Microsoft
// emoji-font policy, not a bug here). An app that has already upgraded to
// the custom-listbox pattern (design-language.md's own escape hatch from
// the plain <select> default) can go one step further and paper over that
// gap too, with a scoped flag webfont - see design-language.md's own
// follow-up bullet for the exact package and CSS. This function's output is
// unchanged either way: plain codepoints, no image asset or lookup table.
//
// Framework-free, like appearance.ts/selectScroll.ts: pure string in,
// string out.

/**
 * Converts an ISO 3166-1 alpha-2 country code ("gb", "DE", ...) to its flag
 * emoji, by mapping each letter to its Unicode regional-indicator symbol
 * (U+1F1E6 = 'A' ... U+1F1FF = 'Z') and concatenating the two codepoints -
 * the same mechanism every flag emoji on every platform already uses, so
 * this needs no image asset or lookup table.
 */
export function flagEmoji(isoCode: string): string {
  return Array.from(isoCode.toUpperCase())
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join('');
}
