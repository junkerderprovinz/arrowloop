// State transitions for the toast queue (design-language.md, "Toasts"). Every
// timing rule is arithmetic over (list, id, now) rather than a live timer, so it
// is testable as plain function calls; the companion hook holds the real
// timers, Date.now() and the portal.
//
// Hover or focus pauses the countdown and keeps the remaining time:
// pauseToast freezes `remainingMs` and resumeToast restarts from it, never from
// the full duration.

export type ToastSeverity = "success" | "warn" | "fail";

/** How long a toast stays: long enough to read, short enough not to pile up. */
export const TOAST_DURATION_MS = 4000;

/** The most toasts shown at once, the largest stack that fits a 720px
 *  viewport. Without a cap, a held Enter key grows the stack off-screen, where
 *  its cards still block clicks on the page. */
export const MAX_VISIBLE_TOASTS = 4;

export interface ToastEntry {
  id: string;
  message: string;
  severity: ToastSeverity;
  /** What is left of the duration, authoritative only while paused
   *  (expiresAt === null). */
  remainingMs: number;
  /** Epoch ms this toast auto-dismisses at, or null while paused. */
  expiresAt: number | null;
}

/** Appends a new toast; toasts stack rather than replace each other. Over
 *  `maxVisible` (at least 1) the oldest running toasts are dropped first, so
 *  the newest feedback always survives.
 *
 *  A paused toast is being read or holds keyboard focus, and since it never
 *  expires it is always the oldest. The cap skips paused toasts while running
 *  ones are left to drop, and drops the oldest paused one only after that. */
export function addToast(
  list: ToastEntry[],
  toast: { id: string; message: string; severity: ToastSeverity },
  now: number,
  durationMs: number = TOAST_DURATION_MS,
  maxVisible: number = MAX_VISIBLE_TOASTS
): ToastEntry[] {
  const newest: ToastEntry = {
    id: toast.id,
    message: toast.message,
    severity: toast.severity,
    remainingMs: durationMs,
    expiresAt: now + durationMs,
  };
  let toDrop = list.length + 1 - maxVisible;
  if (toDrop <= 0) return [...list, newest];
  const kept: ToastEntry[] = [];
  for (const t of list) {
    if (toDrop > 0 && t.expiresAt != null) {
      toDrop--;
      continue;
    }
    kept.push(t);
  }
  if (toDrop > 0) kept.splice(0, toDrop);
  return [...kept, newest];
}

/** Removes one toast and leaves the others alone. Unknown ids are ignored. */
export function removeToast(list: ToastEntry[], id: string): ToastEntry[] {
  return list.filter((t) => t.id !== id);
}

/** Freezes the countdown at what is left and clears expiresAt. A toast that is
 *  already paused is left alone, so moving from the card onto its dismiss
 *  button does not freeze it again. */
export function pauseToast(list: ToastEntry[], id: string, now: number): ToastEntry[] {
  return list.map((t) => {
    if (t.id !== id || t.expiresAt == null) return t;
    return { ...t, remainingMs: Math.max(0, t.expiresAt - now), expiresAt: null };
  });
}

/** Restarts the clock from the frozen remainder. A running toast is left
 *  alone. */
export function resumeToast(list: ToastEntry[], id: string, now: number): ToastEntry[] {
  return list.map((t) => {
    if (t.id !== id || t.expiresAt != null) return t;
    return { ...t, expiresAt: now + t.remainingMs };
  });
}

/** Hover and focus as two flags, because the mouse can leave while the
 *  keyboard is still inside. */
export interface ToastEngagement {
  hover: boolean;
  focus: boolean;
}

export type ToastEngagementKind = keyof ToastEngagement;

/** Neither hovered nor focused. Readonly because one object is shared by every
 *  caller. */
export const NO_ENGAGEMENT: Readonly<ToastEngagement> = { hover: false, focus: false };

/** Folds one hover or focus edge into a toast's engagement and says whether
 *  the countdown may run again: only when both have ended, so moving the mouse
 *  off a toast the keyboard is inside does not dismiss it under the user. When
 *  `engaged` is false the caller can forget the toast's entry. */
export function applyEngagement(
  prev: Readonly<ToastEngagement>,
  kind: ToastEngagementKind,
  active: boolean
): { next: ToastEngagement; engaged: boolean } {
  const next = { ...prev, [kind]: active };
  return { next, engaged: next.hover || next.focus };
}

/** Quiet mode filters by severity: it hides routine successes, never warnings
 *  or failures. */
export function shouldShowToast(severity: ToastSeverity, quiet: boolean): boolean {
  return !quiet || severity !== "success";
}
