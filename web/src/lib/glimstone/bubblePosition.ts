// Placement maths for the shared `.glim-bubble` (design-language.md, "The
// tooltip and info bubble"), ported from reference/tooltip.ts with the same 8px
// margin and the same clamp-then-flip order. It takes plain numbers, so callers
// do the one DOM read and tests need no DOM.

export interface BubbleTriggerRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface BubbleSize {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface BubblePosition {
  left: number;
  top: number;
  /** True when the bubble opens above the trigger because below would clip
   *  and there is room above. */
  above: boolean;
}

/** The gap kept between a bubble and the viewport edge, as in reference/tooltip.ts. */
export const BUBBLE_VIEWPORT_MARGIN = 8;

/**
 * Clamp the bubble horizontally into the viewport with a margin, and flip it
 * above the trigger when opening below would clip the bottom edge and there is
 * room above. A trigger at the very top keeps opening downward.
 *
 * `bubble` is the rendered size (offsetWidth/offsetHeight), since the height
 * depends on how many lines the tip wraps to; measure it after mount.
 */
export function computeBubblePosition(
  trigger: BubbleTriggerRect,
  bubble: BubbleSize,
  viewport: Viewport,
  margin: number = BUBBLE_VIEWPORT_MARGIN
): BubblePosition {
  const centerX = trigger.left + (trigger.right - trigger.left) / 2;
  const halfWidth = bubble.width / 2;
  const left = Math.max(
    margin + halfWidth,
    Math.min(viewport.width - margin - halfWidth, centerX)
  );

  const opensBelowClips = trigger.bottom + margin + bubble.height > viewport.height;
  const roomAbove = trigger.top - margin - bubble.height >= 0;
  const above = opensBelowClips && roomAbove;
  const unclamped = above ? trigger.top - margin - bubble.height : trigger.bottom + margin;
  // A bubble that fits neither below nor above is clamped vertically, because
  // every consumer is position:fixed and an overhang cannot be scrolled to. A
  // bubble taller than the viewport clips wherever it goes, and moving it up
  // would only cover the trigger, so it stays where it opened.
  const fits = bubble.height + 2 * margin <= viewport.height;
  const top = fits
    ? Math.max(margin, Math.min(viewport.height - margin - bubble.height, unclamped))
    : unclamped;

  return { left, top, above };
}
