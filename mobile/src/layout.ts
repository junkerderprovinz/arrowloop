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

/**
 * Returns the widest a menu held against a button's end edge may grow: across
 * the screen to the gutter on the far side. The menu is only as wide as its
 * longest label, so a wide screen does not stretch it.
 */
export function menuRoom(window: number, offset: number, gutter: number): number {
  return window - offset - gutter;
}
