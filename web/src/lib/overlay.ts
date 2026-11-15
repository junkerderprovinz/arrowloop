// What a Popover and a Sheet do with the browser's top layer. A popover is an
// element with the popover attribute: the browser closes it on Escape and on a
// press beside it, and it needs no portal, since nothing clips the top layer.
// A sheet is a <dialog> shown modal, which makes the page behind it inert.

import { computeBubblePosition } from "./bubblePosition.ts";
import { focusedAsker, keepTabInside, returnFocus } from "./dialog.ts";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Whether the browser ties an element to another with CSS anchor positioning. */
export function anchorSupported(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("anchor-name: --a");
}

/** A dashed ident for an anchor, from an id such as React's useId(). */
export function anchorName(id: string): string {
  return `--glim-anchor-${id.replace(/[^\w-]/g, "")}`;
}

/** The open modal sheet in front, where a menu or a bubble opened from inside
 *  it has to render, since <body> lies under the top layer; <body> otherwise. */
export function portalTarget(): HTMLElement {
  const sheets = document.querySelectorAll<HTMLElement>("dialog.glim-sheet[open]");
  return sheets[sheets.length - 1] ?? document.body;
}

/** Whether a popover is open, so a window leaves Escape to it. */
export function popoverIsOpen(): boolean {
  return !!document.querySelector(".glim-popover:popover-open");
}

/**
 * Shows a popover beside its anchor and moves focus into it. `onClose` runs
 * when the browser closes it, on Escape or a press beside it, and focus goes
 * back to the anchor, or to the control inside it when the anchor is a box. Returns the cleanup, which hides it if it is still open.
 */
export function openPopover(popover: HTMLElement, anchor: HTMLElement, name: string, onClose: () => void): () => void {
  let unplace: () => void;
  if (anchorSupported()) {
    anchor.style.setProperty("anchor-name", name);
    popover.style.setProperty("position-anchor", name);
    unplace = () => anchor.style.removeProperty("anchor-name");
  } else {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const at = computeBubblePosition(r, { width: popover.offsetWidth, height: popover.offsetHeight }, { width: innerWidth, height: innerHeight });
      popover.style.left = `${at.left - popover.offsetWidth / 2}px`;
      popover.style.top = `${at.top}px`;
    };
    addEventListener("scroll", place, true);
    addEventListener("resize", place);
    unplace = () => {
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
    };
    popover.showPopover();
    place();
  }
  if (!popover.matches(":popover-open")) popover.showPopover();
  const first = popover.querySelector<HTMLElement>(FOCUSABLE);
  if (first) first.focus();
  else {
    popover.tabIndex = -1;
    popover.focus();
  }
  const onToggle = (e: Event) => {
    if ((e as ToggleEvent).newState !== "closed") return;
    const active = document.activeElement;
    if (!active || active === document.body || popover.contains(active)) (anchor.matches(FOCUSABLE) ? anchor : anchor.querySelector<HTMLElement>(FOCUSABLE) ?? anchor).focus();
    onClose();
  };
  popover.addEventListener("toggle", onToggle);
  return () => {
    popover.removeEventListener("toggle", onToggle);
    unplace();
    if (popover.matches(":popover-open")) popover.hidePopover();
  };
}

/**
 * Shows a sheet modal. Escape and a press on the scrim call `onClose`, which
 * the caller answers by closing it, and focus goes back to the control that
 * asked. Tab wraps inside it, where a modal <dialog> alone lets it out to the
 * browser. Returns the cleanup.
 */
export function openSheet(dialog: HTMLDialogElement, onClose: () => void): () => void {
  const asker = focusedAsker();
  dialog.showModal();
  const onCancel = (e: Event) => {
    e.preventDefault();
    onClose();
  };
  const onClick = (e: MouseEvent) => {
    if (e.target === dialog) onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Tab") keepTabInside(dialog, e);
  };
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("click", onClick);
  dialog.addEventListener("keydown", onKey);
  return () => {
    dialog.removeEventListener("cancel", onCancel);
    dialog.removeEventListener("click", onClick);
    dialog.removeEventListener("keydown", onKey);
    if (dialog.open) dialog.close();
    returnFocus(asker);
  };
}
