// The model behind ContextMenu and MenuBar: what an entry is, how a list is
// tidied, what each row shows, where a menu goes on the screen and which key
// does what. The frameworks only draw it; the glyph type is theirs.

import { pointerWasLast, trackInputModality } from "./inputModality.ts";

// Listening starts with the module rather than with the first menu, which
// mounts after the press that opened it and would miss it.
trackInputModality();

export interface MenuItem<G> {
  label: string;
  glyph?: G;
  /** A colour dot where the glyph would stand, such as a label's colour. */
  color?: string;
  /** The key that runs the same thing, shown as a key cap at the row's end. */
  shortcut?: string;
  /** A figure at the row's end, such as how many files a filter would show. */
  count?: number;
  disabled?: boolean;
  /** Set for an item that is on or off. A checkbox item leaves the menu open,
   *  so several can be ticked in a row. */
  checked?: boolean;
  /** With `checked`: one choice among several. It keeps its glyph, ticks the
   *  current choice at the end and closes the menu like a plain item. */
  radio?: boolean;
  /** Entries that open beside this row. */
  sub?: MenuEntry<G>[];
  /** The id of the menu `sub` opens, for a caller or a script that looks for it. */
  subId?: string;
  onSelect?: () => void;
}

export interface MenuHead<G> {
  head: string;
  /** A pencil at the heading's end, for a group the person keeps themselves,
   *  such as bookmarks. */
  edit?: { tip: string; glyph?: G; onSelect: () => void };
}

/** An item, a heading, or "-" for a separator. */
export type MenuEntry<G> = MenuItem<G> | MenuHead<G> | "-";

export function isMenuHead<G>(entry: MenuEntry<G>): entry is MenuHead<G> {
  return typeof entry === "object" && "head" in entry;
}

/**
 * Drops the separators a list built from parts ends up with: at either end,
 * twice in a row and right under a heading. A menu assembled from whatever
 * applies to the selection then needs no care at each call site.
 */
export function tidyMenu<G>(entries: readonly MenuEntry<G>[]): MenuEntry<G>[] {
  return entries.filter((e, i, all) => {
    if (e !== "-") return true;
    const before = all[i - 1];
    return i > 0 && i < all.length - 1 && before !== "-" && !isMenuHead(before);
  });
}

export interface MenuRowView {
  role: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  /** What stands before the label. */
  lead: "box" | "dot" | "glyph" | "blank";
  /** What stands at the row's end, one thing at most. */
  end: "submenu" | "tick" | "shortcut" | "count" | null;
  /** The radio item that is the current choice, washed with the accent. */
  current: boolean;
  /** A press leaves the menu open. */
  staysOpen: boolean;
}

/** What one row shows. A row without a glyph keeps the glyph's room, so every label starts at one edge. */
export function menuRowView<G>(item: MenuItem<G>): MenuRowView {
  const check = item.checked !== undefined;
  const box = check && !item.radio;
  const on = item.checked === true;
  return {
    role: !check ? "menuitem" : item.radio ? "menuitemradio" : "menuitemcheckbox",
    lead: box ? "box" : item.color ? "dot" : item.glyph ? "glyph" : "blank",
    end: item.sub
      ? "submenu"
      : item.radio && on
        ? "tick"
        : item.shortcut
          ? "shortcut"
          : item.count !== undefined
            ? "count"
            : null,
    current: !!item.radio && on,
    staysOpen: box,
  };
}

interface Size {
  width: number;
  height: number;
}

const EDGE = 8;

/**
 * Where a menu opened at a point goes: at the point, pushed back inside the
 * window by its own size. `above` stands it on the point instead, for a menu
 * opened from a bar at the bottom.
 */
export function placeMenu(x: number, y: number, menu: Size, view: Size, above = false): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(x, view.width - menu.width - EDGE)),
    top: above ? Math.max(EDGE, y - menu.height - EDGE) : Math.max(EDGE, Math.min(y, view.height - menu.height - EDGE)),
  };
}

/**
 * Where a submenu goes: beside its row on the reading side, on the other side
 * when that has no room, and level with the row as far as the window allows.
 */
export function placeSubmenu(
  row: { left: number; right: number; top: number },
  menu: Size,
  view: Size,
  rtl = false,
): { left: number; top: number } {
  const after = row.right + 6;
  const before = row.left - menu.width - 6;
  const fitsAfter = after + menu.width <= view.width;
  const fitsBefore = before >= 0;
  const left = rtl ? (fitsBefore ? before : after) : fitsAfter ? after : before;
  return { left, top: Math.max(EDGE, Math.min(row.top - 6, view.height - menu.height - EDGE)) };
}

export type MenuMove = "next" | "prev" | "first" | "last" | "in" | "out";

/** What a key does inside an open menu. Right and left swap under a right-to-left page. */
export function menuMove(key: string, rtl = false): MenuMove | null {
  switch (key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "ArrowRight":
      return rtl ? "out" : "in";
    case "ArrowLeft":
      return rtl ? "in" : "out";
  }
  return null;
}

/** The rows a key can reach, in order: every enabled button of the menu. */
export function menuRows(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>("button:not([disabled])"));
}

/**
 * Puts the focus on a menu's first row as it opens. A menu the pointer opened
 * carries `data-pointer` until a key is pressed in it, and the row shows no
 * ring or wash meanwhile: the mouse never asked for that focus, and a lit
 * first row reads as a choice already made.
 */
export function focusFirstMenuRow(menu: HTMLElement): void {
  if (pointerWasLast()) {
    menu.dataset.pointer = "";
    menu.addEventListener("keydown", () => delete menu.dataset.pointer, { once: true });
  }
  menuRows(menu)[0]?.focus();
}

/** Moves the focus along a menu's rows, wrapping at both ends. */
export function focusMenuRow(menu: HTMLElement, move: "next" | "prev" | "first" | "last"): void {
  const rows = menuRows(menu);
  if (rows.length === 0) return;
  const last = rows.length - 1;
  const at = rows.indexOf(document.activeElement as HTMLElement);
  let next = move === "first" ? 0 : move === "last" ? last : at + (move === "next" ? 1 : -1);
  if (at < 0 && move === "prev") next = last;
  rows[(next + rows.length) % rows.length].focus();
}

// One menu is open at a time in the whole document. Opening one closes the
// last, and Escape reaches the open one from anywhere, so a window under it
// keeps its own Escape for later.
let openMenu: ((byEscape: boolean) => void) | null = null;

function onMenuKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !openMenu) return;
  e.preventDefault();
  openMenu(true);
}

/**
 * Registers a menu as the open one and closes any other. `close` hears
 * whether Escape closed it, which hands focus back, or another menu took its
 * place. Returns the release to call when it closes.
 */
export function claimMenu(close: (byEscape: boolean) => void): () => void {
  const previous = openMenu;
  openMenu = close;
  if (previous && previous !== close) previous(false);
  else if (!previous) document.addEventListener("keydown", onMenuKey);
  return () => {
    if (openMenu !== close) return;
    openMenu = null;
    document.removeEventListener("keydown", onMenuKey);
  };
}

/** Whether a menu is open, for a key handler of the app's that should leave it alone. */
export function menuIsOpen(): boolean {
  return openMenu !== null;
}

/**
 * Closes a menu on a click anywhere outside the given elements, such as the
 * menu, its submenu and the control that opened it. A click rather than a
 * press: the window under a menu reads the press, and while the menu is still
 * open it knows to stay. Returns the cleanup.
 */
export function closeMenuOutside(inside: () => (Element | null | undefined)[], close: () => void): () => void {
  function onClick(e: MouseEvent) {
    const target = e.target as Node;
    if (!inside().some((el) => el?.contains(target))) close();
  }
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
