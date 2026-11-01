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

/**
 * Where a list head's filter opens: under the head, its leading edge in line
 * with the head's, moved back towards the start where the end would run out
 * of room, and never past `area`, the column the list stands in, so it does
 * not cover the sidebar. It flips above like a menu.
 */
export function placeUnderHead(
  head: BubbleTriggerRect,
  trigger: BubbleTriggerRect,
  panel: BubbleSize,
  area: { left: number; right: number },
  viewport: Viewport,
  rtl = false,
): { left: number; top: number } {
  const margin = BUBBLE_VIEWPORT_MARGIN
  const first = area.left + margin
  const last = Math.max(first, area.right - margin - panel.width)
  const wanted = rtl ? head.right - panel.width : head.left
  const left = Math.max(first, Math.min(wanted, last))
  return { left, top: placeMenu(trigger, panel, viewport, rtl).top }
}
