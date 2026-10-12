// A browser without a hyphenation dictionary for the language, as a desktop
// Chromium often is, breaks a long word at the last letter that fits, which
// leaves one letter alone on the second line. One soft hyphen near the middle
// gives it a better place, and is invisible wherever the word fits.

const SHY = String.fromCharCode(0xad)

/** Words shorter than this fit a tile, a bar slot or a badge in every language. */
const LONG = 14

const VOWELS = /[aeiouyäöüàáâãåæèéêëìíîïòóôõøœùúûýаеёиоуыэюяіїєαεηιουωάέήίόύώ]/i
const LETTER = /\p{L}/u

/**
 * Puts one soft hyphen into each long word, before a consonant that opens a
 * syllable (a consonant followed by a vowel, after another consonant), the one
 * nearest the middle of the word.
 */
export function softHyphen(text: string): string {
  return text
    .split(' ')
    .map((word) => {
      if (word.length < LONG) return word
      const middle = word.length / 2
      let best = -1
      for (let i = Math.ceil(word.length * 0.3); i <= Math.floor(word.length * 0.7); i++) {
        const opens =
          LETTER.test(word[i - 1]) && !VOWELS.test(word[i - 1]) && LETTER.test(word[i]) && !VOWELS.test(word[i]) && VOWELS.test(word[i + 1] ?? '')
        if (opens && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i
      }
      return best < 0 ? word : word.slice(0, best) + SHY + word.slice(best)
    })
    .join(' ')
}
