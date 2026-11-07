// The breakpoints a component reads in script rather than in CSS, because they
// change what it renders or what it says, not only how it looks.

/** At least this wide is the desktop shell; below it a well pins its segments. */
export const DESKTOP_QUERY = "(min-width: 48rem)";

/** At least this wide, the column of tiles shows words; below it glyphs alone. */
export const WIDE_QUERY = "(min-width: 64rem)";

/** The query for a window narrower than this many pixels. */
export function narrowerThan(px: number): string {
  return `(max-width: ${px - 0.02}px)`;
}

export function mediaMatches(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}

/** Calls `fn` whenever the query flips, and returns the unsubscribe. */
export function subscribeMedia(query: string, fn: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const list = matchMedia(query);
  list.addEventListener("change", fn);
  return () => list.removeEventListener("change", fn);
}
