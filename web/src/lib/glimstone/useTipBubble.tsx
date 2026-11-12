import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { dismissBubbleOn, placeBubble } from "../tipBubble.ts";
import { pointerWasLast, trackInputModality } from "../inputModality.ts";
import { portalTarget } from "../overlay.ts";

// The one hover and focus tooltip, as a hook. The "(i)" of InfoBubble, a
// bare IconTipButton, a SelectorTab segment and a Button whose text the label
// engine hides are all triggers of this same bubble (design-language.md, "The
// tooltip and info bubble"). A trigger owns its element, its classes and when
// it has something to say; placing and dismissing live in the core.
//
// The native `title=` attribute never shows on keyboard focus and cannot be
// styled, which is why this hook exists.

export interface TipBubble {
  /** Ref callback for the trigger element the bubble is placed against. A
   *  callback, so a trigger that keeps its own ref can feed both from one
   *  attribute. */
  ref: (el: HTMLElement | null) => void;
  /** Spread on the trigger. Focus opens the bubble too, when it came from the
   *  keyboard. */
  handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  /** `aria-describedby` while open, so the bubble is announced as the
   *  trigger's description. */
  describedBy: string | undefined;
  /** The bubble, portalled to <body> so no card's `overflow: hidden` clips it,
   *  or null when there is nothing to show. Render it beside the trigger. */
  bubble: ReactNode;
  /** Wraps a disabled trigger with a tip in a box that still sees the pointer,
   *  since a disabled <button> emits no mouse events. Other triggers pass
   *  through unchanged. */
  wrap: (node: ReactNode) => ReactNode;
  /** Open or close by hand, for a hover wrapper of the call site's own. */
  show: () => void;
  hide: () => void;
}

/**
 * @param tip  What the bubble says. When it is empty nothing opens or renders
 *             and `wrap` passes its node through.
 * @param disabled  Whether the trigger is currently disabled; see `wrap`.
 */
export function useTipBubble(tip?: string, disabled = false): TipBubble {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();

  // Flipping `disabled` replaces the trigger element: `wrap` boxes a disabled
  // one, so React mounts a new <button> in its place. The old one takes its
  // focus and hover with it without firing blur or mouseleave, so an open
  // bubble would stay up for good. Closing during render keeps it from being
  // painted even once; a pointer still over the control reopens it on its
  // next move, through the wrapper's mouseenter.
  const [seenDisabled, setSeenDisabled] = useState(disabled);
  if (seenDisabled !== disabled) {
    setSeenDisabled(disabled);
    setOpen(false);
  }

  const shown = !!tip && open;

  function show() {
    if (!tip) return;
    setOpen(true);
  }
  function hide() {
    setOpen(false);
  }
  useEffect(trackInputModality, []);
  function showOnFocus() {
    if (!pointerWasLast()) show();
  }

  useLayoutEffect(() => {
    if (shown && triggerRef.current && bubbleRef.current) placeBubble(triggerRef.current, bubbleRef.current);
  }, [shown]);

  useEffect(() => (shown ? dismissBubbleOn(hide) : undefined), [shown]);

  return {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
    },
    handlers: {
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: showOnFocus,
      onBlur: hide,
    },
    describedBy: shown ? tooltipId : undefined,
    bubble: shown
      ? createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            id={tooltipId}
            className="glim-bubble glim-fade"
          >
            {tip}
          </div>,
          portalTarget(),
        )
      : null,
    wrap: (node: ReactNode) =>
      disabled && tip ? (
        <span className="glim-tip-wrap" onMouseEnter={show} onMouseLeave={hide}>
          {node}
        </span>
      ) : (
        node
      ),
    show,
    hide,
  };
}
