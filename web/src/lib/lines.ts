/** entries reads a list kept one entry per line, without blank lines or the spaces around an entry. */
export function entries(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}
