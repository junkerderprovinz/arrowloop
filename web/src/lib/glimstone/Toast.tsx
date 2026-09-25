import type { ToastSeverity } from "./toastEngine";

// The toast system's presentational half (design-language.md, "Toasts"). These
// components hold no state, so a test can call them with props; the companion
// hook owns the queue, the timers and the portal that lets `position: fixed`
// escape a transformed ancestor.
//
// A toast never blocks the page: the viewport is `pointer-events: none` and only
// each card turns them back on, so clicks pass through the empty corner.

export interface ToastCardProps {
  id: string;
  message: string;
  severity: ToastSeverity;
  /** Accessible name for the dismiss button, the same for every toast. */
  dismissLabel: string;
  onDismiss: (id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: (id: string) => void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
}

// Severity shows only in the glyph's state hue (rule 4), never as a coloured
// rail on the card (rule 5).
const SEVERITY_ICON_CLASS: Record<ToastSeverity, string> = {
  success: "text-statusOkSolid",
  warn: "text-statusWarnSolid",
  fail: "text-statusFailSolid",
};

// "alert" is assertive, so a failure interrupts the screen reader; "status" is
// polite. Each toast is a new element, which both roles announce on insertion,
// so no separate aria-live wrapper is needed.
function roleFor(severity: ToastSeverity): "alert" | "status" {
  return severity === "success" ? "status" : "alert";
}

// Filled shapes (design-language.md, "Icon glyphs"). The mark inside each is
// painted in the card's own surface colour so it reads as a cutout.
function ToastGlyph({ severity }: { severity: ToastSeverity }) {
  const className = `mt-0.5 shrink-0 ${SEVERITY_ICON_CLASS[severity]}`;
  const cutout = "var(--carbon-surface, transparent)";
  if (severity === "fail") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
        <circle cx="8" cy="8" r="6.4" />
        <rect x="7.3" y="4.6" width="1.4" height="4" rx="0.7" fill={cutout} />
        <circle cx="8" cy="10.9" r="0.85" fill={cutout} />
      </svg>
    );
  }
  if (severity === "warn") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
        <path d="M8 2.2 14.5 13.6H1.5L8 2.2Z" />
        <rect x="7.3" y="6.6" width="1.4" height="3" rx="0.7" fill={cutout} />
        <circle cx="8" cy="11.9" r="0.85" fill={cutout} />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="6.4" />
      <rect x="4.5" y="8.4" width="3.5" height="1.5" rx="0.75" fill={cutout} transform="rotate(45 6.25 9.15)" />
      <rect x="5.815" y="7.25" width="6.27" height="1.5" rx="0.75" fill={cutout} transform="rotate(-50.2 8.95 8)" />
    </svg>
  );
}

export function ToastCard({
  id,
  message,
  severity,
  dismissLabel,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: ToastCardProps) {
  return (
    <div
      role={roleFor(severity)}
      // React's onFocus and onBlur bubble, so tabbing onto the dismiss button
      // pauses the countdown like a hover does.
      onMouseEnter={() => onMouseEnter(id)}
      onMouseLeave={() => onMouseLeave(id)}
      onFocus={() => onFocus(id)}
      onBlur={() => onBlur(id)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss(id);
        }
      }}
      className="glim-toast pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-card bg-carbon-surface px-3.5 py-3 text-carbon-text"
    >
      <ToastGlyph severity={severity} />
      <p className="min-w-0 flex-1 text-sm leading-snug wrap-break-word">{message}</p>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label={dismissLabel}
        className="-m-1 shrink-0 rounded-pill p-1 text-carbon-textMuted opacity-80 hover:bg-carbon-hover hover:text-carbon-text hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="6.8" y="2.5" width="2.4" height="11" rx="0.6" transform="rotate(45 8 8)" />
          <rect x="6.8" y="2.5" width="2.4" height="11" rx="0.6" transform="rotate(-45 8 8)" />
        </svg>
      </button>
    </div>
  );
}

export interface ToastViewportEntry {
  id: string;
  message: string;
  severity: ToastSeverity;
}

export interface ToastViewportProps {
  toasts: ToastViewportEntry[];
  dismissLabel: string;
  onDismiss: (id: string) => void;
  // Four separate events rather than onPause and onResume, because the caller
  // resumes only once hover and focus have both ended (applyEngagement).
  onMouseEnter: (id: string) => void;
  onMouseLeave: (id: string) => void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
}

// The bottom-end corner follows writing direction. Toasts render in array order,
// so the newest sits nearest the bottom edge. The overflow only matters on a
// very short viewport, where it keeps the stack scrollable.
//
// The inset is padding inside the box rather than an offset of it, because
// `overflow-y: auto` also clips horizontally and would cut off the cards'
// shadows and the sideways slide of their entrance.
export function ToastViewport({ toasts, dismissLabel, onDismiss, onMouseEnter, onMouseLeave, onFocus, onBlur }: ToastViewportProps) {
  return (
    <div className="pointer-events-none fixed bottom-0 end-0 z-[70] flex max-h-screen flex-col gap-2 overflow-y-auto p-4">
      {toasts.map((t) => (
        <ToastCard
          key={t.id}
          id={t.id}
          message={t.message}
          severity={t.severity}
          dismissLabel={dismissLabel}
          onDismiss={onDismiss}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      ))}
    </div>
  );
}
