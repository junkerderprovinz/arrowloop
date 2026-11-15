import { useTipBubble } from "./useTipBubble.tsx";

// A neutral (i) icon beside a label that reveals a short help text on hover and
// keyboard focus. Explanations live here rather than as a permanent grey
// paragraph under the control. The icon never takes the accent colour, which
// means "active"; the bubble itself comes from useTipBubble.
//
// `onAccent` is for an icon inside a filled accent badge such as a card heading:
// it inherits the badge's --accent-contrast ink and drops the idle opacity, which
// has less margin on a busy fill.
export function InfoBubble({ tip, onAccent = false }: { tip: string; onAccent?: boolean }) {
  const tooltip = useTipBubble(tip);

  return (
    <>
      <span
        data-glim="InfoBubble"
        ref={tooltip.ref}
        role="img"
        aria-label={tip}
        aria-describedby={tooltip.describedBy}
        tabIndex={0}
        {...tooltip.handlers}
        // Inside a <label>, a click on a span is forwarded to the label's field,
        // which takes focus and closes the bubble at once. stopPropagation does
        // not stop the native forwarding; preventDefault does, and the span
        // keeps the focus it took on mousedown.
        onClick={(e) => e.preventDefault()}
        className={onAccent ? "glim-info-icon glim-info-icon--on-accent" : "glim-info-icon"}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="4.6" r="0.9" fill="currentColor" />
          <path d="M8 7v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
      {tooltip.bubble}
    </>
  );
}
