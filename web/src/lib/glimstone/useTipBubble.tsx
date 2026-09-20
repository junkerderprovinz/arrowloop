import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { computeBubblePosition } from "./bubblePosition";

// The one hover and focus tooltip, as a hook. The "(i)" of InfoBubble, a
// bare IconTipButton, a SelectorTab segment and a Button whose text the label
// engine hides are all triggers of this same bubble (design-language.md, "The
// tooltip and info bubble"). A trigger owns its element, its classes and when
// it has something to say; the positioning lives here once.
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
  // Focus opens the bubble only when the keyboard was used last. Opening on
  // focus is for Tab users. A mouse user gets focus as a side effect, from a
  // click or from a dialog handing it back to its opener (useConfirm), and a
  // bubble opened then stays where the pointer no longer is.
  useEffect(trackInputModality, []);
  function showOnFocus() {
    if (!pointerWasLast) show();
  }

  // The bubble is measured after it mounts, because its wrapped height depends
  // on the tip's length, and placed before paint so it never visibly jumps.
  useLayoutEffect(() => {
    if (!shown) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const r = trigger.getBoundingClientRect();
    const viewport = {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    };
    const { left, top } = computeBubblePosition(
      r,
      { width: bubble.offsetWidth, height: bubble.offsetHeight },
      viewport,
    );
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }, [shown]);

  // Scrolling would leave the bubble behind its trigger, and Escape has to
  // dismiss it without a pointer move.
  useEffect(() => {
    if (!shown) return;
    const onScroll = () => hide();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [shown]);

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
          document.body,
        )
      : null,
    wrap: (node: ReactNode) =>
      disabled && tip ? (
        <span className="inline-flex" onMouseEnter={show} onMouseLeave={hide}>
          {node}
        </span>
      ) : (
        node
      ),
    show,
    hide,
  };
}

// Whether the last input was a pointer rather than a key. It is tracked for the
// whole page because focus often lands on one element after the user acted on
// another, such as a dialog handing focus back to its opener.
//
// Not `:focus-visible`: jsdom evaluates it after React's focus handler runs, so
// inside the handler it reads false for keyboard focus too.
let pointerWasLast = false;
let tracking = false;

function trackInputModality() {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener("pointerdown", () => (pointerWasLast = true), true);
  document.addEventListener("keydown", () => (pointerWasLast = false), true);
}
