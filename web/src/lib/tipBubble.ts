// The DOM half of the one hover and focus bubble that a framework component
// opens next to its trigger (design-language.md, "The tooltip and info
// bubble"). The framework owns the open state and renders the bubble into
// <body>; these place it and close it again.

import { computeBubblePosition } from "./bubblePosition.ts";

/**
 * Places a rendered bubble against its trigger. Call it after the bubble
 * mounts and before paint, because its wrapped height depends on the tip's
 * length and a bubble placed later visibly jumps.
 */
export function placeBubble(trigger: HTMLElement, bubble: HTMLElement): void {
  const viewport = {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
  const { left, top } = computeBubblePosition(
    trigger.getBoundingClientRect(),
    { width: bubble.offsetWidth, height: bubble.offsetHeight },
    viewport,
  );
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

/**
 * Closes an open bubble on any scroll, which would leave it behind its
 * trigger, and on Escape, which has to work without a pointer move. Returns
 * the cleanup.
 */
export function dismissBubbleOn(hide: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") hide();
  };
  window.addEventListener("scroll", hide, true);
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("scroll", hide, true);
    window.removeEventListener("keydown", onKey);
  };
}
