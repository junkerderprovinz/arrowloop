// A native <option> holds plain text only, so a flag has to be an emoji to sit
// in a plain <select> language list. Windows renders these codepoints as a
// two-letter tag rather than a flag; design-language.md ("The user-owned axes",
// Language) describes the webfont an app with a custom listbox can add for that.

/**
 * Converts an ISO 3166-1 alpha-2 country code ("gb", "DE", ...) to its flag
 * emoji by mapping each letter to its regional-indicator symbol (U+1F1E6 = 'A'
 * ... U+1F1FF = 'Z').
 *
 * Only the first two letters count, so a subdivision code such as "es-ct" shows
 * its country's flag instead of two flags and a hyphen. Unicode has flags for
 * only three subdivisions, and the language name beside the flag identifies it
 * anyway. A code with fewer than two letters returns an empty string.
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
