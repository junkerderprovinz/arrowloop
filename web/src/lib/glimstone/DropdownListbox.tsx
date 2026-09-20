import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { computeBubblePosition } from "./bubblePosition";
import { usePortalHue } from "./portalHue";

// The `role="listbox"` panel a button-opens-a-list picker drops open. It is
// portalled to document.body, because a card with `overflow: hidden` clips an
// absolutely positioned panel whatever its z-index, and placed with
// computeBubblePosition, which clamps it into the viewport and flips it above
// the trigger when needed.
//
// The panel takes the trigger's width and is centred on it with
// `translateX(-50%)`, since computeBubblePosition returns the centre. Equal
// widths look start-aligned and need no RTL branch.

/** The gap to the trigger and the minimum distance from the viewport edge,
 *  4px to match `mt-1`. */
const DROPDOWN_GAP = 4;

export interface DropdownListboxProps {
  /** Whether the panel is mounted. The caller owns the trigger; only the
   *  panel is shared. */
  open: boolean;
  /** Called when the panel dismisses itself (outside click, Escape, scroll,
   *  resize). Picking an option does not call it: a single-select list closes
   *  itself at the call site, a multi-select one stays open. */
  onClose: () => void;
  /** The trigger, which anchors the panel and is exempt from the outside-click
   *  dismissal so clicking it does not close and reopen the list. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Accessible name for the listbox, normally the same label the trigger
   *  carries. */
  label: string;
  /** `aria-multiselectable`, for a checkbox multi-select list. */
  multiselectable?: boolean;
  /** The `role="option"` buttons. */
  children: ReactNode;
}

export function DropdownListbox({
  open,
  onClose,
  triggerRef,
  label,
  multiselectable,
  children,
}: DropdownListboxProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  // One focus move per opening, once the panel sits at its real coordinates.
  const focusedOnOpen = useRef(false);
  // Whether focus is inside the panel, tracked as it moves because it cannot be
  // read at teardown.
  const focusInsideRef = useRef(false);
  useEffect(() => {
    if (!open) focusedOnOpen.current = false;
  }, [open]);
  // Read through a ref so an inline onClose does not re-attach every listener
  // on each render, which happens on every toggle in a multi-select list.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The next open re-measures instead of flashing at the old coordinates.
  useLayoutEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  // The portal leaves the trigger's rainbow subtree, so the panel copies the
  // trigger's hue.
  const hue = usePortalHue(open, triggerRef);

  // Measured and placed before paint, so the panel never jumps from its
  // off-screen parking spot.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    // The width is written to the node before the height is read, because
    // option labels wrap against it. `pos` receives the same value below.
    panel.style.width = `${rect.width}px`;
    const viewport = {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    };
    const { left, top } = computeBubblePosition(
      rect,
      { width: rect.width, height: panel.offsetHeight },
      viewport,
      DROPDOWN_GAP
    );
    // `children` is a dependency so a list that changes length while open is
    // re-measured. Its identity changes on every render, so returning the
    // previous object when nothing moved is what stops an endless loop.
    setPos((prev) =>
      prev && prev.left === left && prev.top === top && prev.width === rect.width
        ? prev
        : { left, top, width: rect.width }
    );
  }, [open, triggerRef, children]);

  // A fixed panel that has lost its trigger reads as broken, so an outside
  // press, Escape, scroll or resize closes it. The panel itself is exempt from
  // the outside press, or pressing an option would unmount the list before its
  // click landed. The scroll listener captures on `window` to see nested
  // scroll containers, and ignores scrolls inside the panel, which scrolls a
  // long list itself.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onCloseRef.current();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    function onScroll(e: Event) {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      onCloseRef.current();
    }
    function onResize() {
      onCloseRef.current();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, triggerRef]);

  // The options are the caller's children, so they are found in the DOM by
  // their role.
  function options(): HTMLElement[] {
    const panel = panelRef.current;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>('[role="option"]'));
  }

  // Focus moves to the selected option on open, so a keyboard user reaches the
  // list. It waits for `pos`: focusing an option parked at -9999px makes the
  // browser scroll to it, and that scroll closes the panel.
  useLayoutEffect(() => {
    if (!open || !pos || focusedOnOpen.current) return;
    const opts = options();
    if (opts.length === 0) return;
    const active = opts.find((o) => o.getAttribute("aria-selected") === "true") ?? opts[0];
    focusedOnOpen.current = true;
    active.scrollIntoView?.({ block: "nearest" });
    active.focus();
  }, [open, pos]);

  // Focus returns to the trigger on close only if it was inside the panel; a
  // click elsewhere has already put it where the user wants. By cleanup time
  // the portal is gone and focus sits on <body>, hence the tracked flag. The
  // panel's onBlur clears it only when focus leaves the panel, so arrowing
  // between options keeps it.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    return () => {
      if (focusInsideRef.current) trigger?.focus();
      focusInsideRef.current = false;
    };
  }, [open, triggerRef]);

  // Arrows, Home and End move between options here so every listbox behaves
  // alike. Enter and Space need nothing: the options are real buttons.
  function onPanelKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const opts = options();
    if (opts.length === 0) return;
    e.preventDefault();
    const at = opts.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = opts.length - 1;
    else {
      const dir = e.key === "ArrowDown" ? 1 : -1;
      next = at < 0 ? (dir === 1 ? 0 : opts.length - 1) : (at + dir + opts.length) % opts.length;
    }
    opts[next].scrollIntoView?.({ block: "nearest" });
    opts[next].focus();
  }

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      onKeyDown={onPanelKeyDown}
      onFocus={() => {
        focusInsideRef.current = true;
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusInsideRef.current = false;
      }}
      aria-multiselectable={multiselectable ? "true" : undefined}
      aria-label={label}
      className={`fixed z-50 max-h-60 overflow-y-auto rounded-card bg-carbon-surface shadow-xl glim-fade${
        hue.className ? ` ${hue.className}` : ""
      }`}
      style={{
        // Parked off-screen until measured, since the panel needs to be in the
        // DOM at its real width to have a height.
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width: pos?.width,
        transform: "translateX(-50%)",
        scrollbarColor: "var(--carbon-border) transparent",
        ...(hue.style ?? {}),
      } as CSSProperties}
    >
      {children}
    </div>,
    document.body
  );
}
