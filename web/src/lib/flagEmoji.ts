// Copied verbatim from GlimStone 1.10.0, reference/flagEmoji.ts.
// Do not edit here: change it in the design language repo and copy again.
// https://github.com/junkerderprovinz/glimstone
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
 *
 * ONLY THE FIRST TWO LETTERS, and that is the whole of the fix this function
 * needed. It used to map EVERY character it was given, which is correct for a
 * two-letter code and wrong for everything else: a subdivision code like
 * "es-ct" became five codepoints, so "ES" rendered as Spain's flag, the hyphen
 * rendered as itself, and "CT" formed a SECOND regional-indicator pair - three
 * glyphs where one was asked for, reported as "bei manchen sind zwei flaggen".
 *
 * A subdivision therefore shows its COUNTRY's flag. That is the honest answer
 * rather than a compromise: Unicode has tag sequences for exactly three
 * subdivisions (England, Scotland, Wales) and nothing for anywhere else, so
 * Catalonia, Galicia and the Basque Country have no flag emoji to show. The
 * NAME beside it is what identifies the language anyway - it is written in
 * itself, which is why somebody scanning the list finds "Català" before they
 * look at any flag.
 *
 * A code with no letters at all answers an empty string rather than garbage,
 * because a caller that hands this a country it does not have should get
 * nothing to draw rather than two stray boxes.
 */
export function flagEmoji(isoCode: string): string {
  const letters = String(isoCode ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
  if (letters.length < 2) return '';
  return Array.from(letters)
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join('');
}
