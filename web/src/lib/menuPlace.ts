import { BUBBLE_VIEWPORT_MARGIN, type BubbleSize, type BubbleTriggerRect, type Viewport } from './glimstone/bubblePosition'

/** The gap between the button and the menu it opens, as the listbox keeps. */
const GAP = 4

/**
 * Where a menu opens: under its button with the two trailing edges in line, so
 * it grows back across the card rather than out of the window. It flips above
 * when below would clip and there is more room above, and it is clamped into
 * the viewport with the bubble's margin either way.
 */
export function placeMenu(
  trigger: BubbleTriggerRect,
  menu: BubbleSize,
  viewport: Viewport,
  rtl = false,
): { left: number; top: number } {
  const margin = BUBBLE_VIEWPORT_MARGIN
  const wanted = rtl ? trigger.left : trigger.right - menu.width
  const left = Math.max(margin, Math.min(wanted, viewport.width - menu.width - margin))

  const below = trigger.bottom + GAP
  const fitsBelow = below + menu.height <= viewport.height - margin
  const roomAbove = trigger.top - GAP - margin
  const roomBelow = viewport.height - margin - below
  const top = !fitsBelow && roomAbove > roomBelow ? Math.max(margin, trigger.top - GAP - menu.height) : below
  return { left, top }
}
