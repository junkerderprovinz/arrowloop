/**
 * The widest a page's column of cards grows. A tablet held sideways would
 * otherwise stretch every card and row across the whole screen.
 */
export const COLUMN = 720;

/** The widest a dialog grows, narrower than a page since it holds one task. */
export const DIALOG = 560;

/** Returns the room beside a centred column, never less than the page's own gutter. */
export function sideRoom(window: number, gutter: number): number {
  return Math.max(gutter, (window - COLUMN) / 2);
}
