import { Fragment, useEffect, useRef } from "react";
import { announce, liveRegionAttrs } from "../announce.ts";
import { MARKS, TOAST_MARKS } from "../marks.ts";
import { softBreaks, toastPoliteness, type ToastAction, type ToastSeverity } from "../toastEngine.ts";
import { Button } from "./Button.tsx";
import { MarkSvg } from "./glyphs.tsx";

// The toast system's presentational half (design-language.md, "Toasts"). These
// components hold no state, so a test can call them with props; the companion
// hook owns the queue, the timers and the portal that lets `position: fixed`
// escape a transformed ancestor.
//
// A toast never blocks the page: the viewport is `pointer-events: none` and only
// each card turns them back on, so clicks pass through the empty corner.
//
// The viewport holds the page's two live regions for good, and a new toast's
// message is read out through them. A card that carried a live role itself
// would be announced on arrival by some screen readers and not by others.

export interface ToastCardProps {
  id: string;
  message: string;
  severity: ToastSeverity;
  /** A button such as Undo. A press runs it and dismisses the toast. */
  action?: ToastAction;
  /** Accessible name for the dismiss button, the same for every toast. */
  dismissLabel: string;
  onDismiss: (id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: (id: string) => void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
}

export function ToastCard({
  id,
  message,
  severity,
  action,
  dismissLabel,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: ToastCardProps) {
  return (
    <div
      data-glim="ToastCard"
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
      className="glim-toast glim-toast-card"
    >
      <MarkSvg mark={TOAST_MARKS[severity]} className={`glim-toast-glyph glim-toast-glyph--${severity}`} />
      <div className="glim-toast-body">
        <p className="glim-toast-message">
          {softBreaks(message).map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <wbr />}
              {part}
            </Fragment>
          ))}
        </p>
        {action && (
          <Button
            className="glim-toast-action"
            tone="subtle"
            label={action.label}
            labelKey={null}
            onClick={() => {
              action.onClick();
              onDismiss(id);
            }}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label={dismissLabel}
        className="glim-btn-bare glim-toast-dismiss"
      >
        <MarkSvg mark={MARKS.dismiss} />
      </button>
    </div>
  );
}

export interface ToastViewportEntry {
  id: string;
  message: string;
  severity: ToastSeverity;
  action?: ToastAction;
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

// Toasts render in array order, so the newest sits nearest the bottom edge.
export function ToastViewport({ toasts, dismissLabel, onDismiss, onMouseEnter, onMouseLeave, onFocus, onBlur }: ToastViewportProps) {
  const heard = useRef(new Set<string>());
  useEffect(() => {
    const ids = new Set(toasts.map((t) => t.id));
    for (const id of heard.current) if (!ids.has(id)) heard.current.delete(id);
    for (const t of toasts) {
      if (heard.current.has(t.id)) continue;
      heard.current.add(t.id);
      announce(t.message, toastPoliteness(t.severity));
    }
  }, [toasts]);
  return (
    <>
    <div className="glim-sr-only" {...liveRegionAttrs("polite")} />
    <div className="glim-sr-only" {...liveRegionAttrs("assertive")} />
    <div data-glim="ToastViewport" className="glim-toast-stack">
      {toasts.map((t) => (
        <ToastCard
          key={t.id}
          id={t.id}
          message={t.message}
          severity={t.severity}
          action={t.action}
          dismissLabel={dismissLabel}
          onDismiss={onDismiss}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      ))}
    </div>
    </>
  );
}
