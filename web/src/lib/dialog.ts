// What every modal window does with the keyboard (design-language.md,
// "Behaviour contracts", the dialog rows): Escape cancels from anywhere, Tab
// stays inside, and focus goes back to the control that asked.

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Turns a Tab that would leave the card back to its first or last control.
 * Focus that sits outside the card, on <body> for one, is pulled back in.
 */
export function keepTabInside(card: HTMLElement | null, e: KeyboardEvent): void {
  if (!card) return;
  const focusables = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  const inside = active instanceof Node && card.contains(active);
  if (e.shiftKey) {
    if (!inside || active === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Escape from anywhere and a Tab trap over the dialog's own controls, so focus
 * never reaches the page it covers. The listener sits on the document because
 * one on the dialog stops firing once focus falls to <body>. Returns the
 * cleanup.
 */
export function trapDialogKeys(dialog: () => HTMLElement | null, onCancel: () => void): () => void {
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Tab") keepTabInside(dialog(), e);
  }
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

/**
 * The control that has focus before a dialog opens, to hand it back on close.
 * Read it before the dialog renders, which moves focus into it.
 */
export function focusedAsker(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** Gives focus back to the asker, unless it left the page while the dialog was open. */
export function returnFocus(asker: HTMLElement | null): void {
  if (asker && document.contains(asker)) asker.focus();
}
