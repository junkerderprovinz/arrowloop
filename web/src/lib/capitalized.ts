/**
 * Text with its first letter raised as the language raises it, for words a
 * table keeps in lower case because they also sit inside a sentence.
 */
export function capitalized(text: string, lang: string): string {
  return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1)
}
