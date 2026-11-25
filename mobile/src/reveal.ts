/**
 * Where a page scrolls to so that a focused field and the room under it end
 * above the keyboard, or null when they already do. The room holds the control
 * that follows a field, usually the button it enables: a button left half under
 * the keyboard looks pressable at its edge, but a tap there misses it, closes the
 * keyboard and does nothing else.
 */
export function revealScroll(fieldTop: number, fieldHeight: number, scrolled: number, visible: number, room: number): number | null {
  const bottom = fieldTop + fieldHeight + room;
  return bottom > scrolled + visible ? bottom - visible : null;
}
