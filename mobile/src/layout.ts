import type { LabelMode } from "./settings";

/**
 * The widest a page's column of cards grows. A tablet held sideways would
 * otherwise stretch every card and row across the whole screen.
 */
export const COLUMN = 720;

/** The widest a dialog grows, narrower than a page since it holds one task. */
export const DIALOG = 560;

/** Returns the room beside a centred column, never less than the page's own gutter. */
export function sideRoom(window: number, gutter: number, column: number = COLUMN): number {
  return Math.max(gutter, (window - column) / 2);
}

/** Where Material's medium and expanded window classes begin, in dp of width. */
export const MEDIUM = 600;
export const EXPANDED = 840;

export type WidthClass = "compact" | "medium" | "expanded";

export function widthClass(width: number): WidthClass {
  if (width >= EXPANDED) return "expanded";
  return width >= MEDIUM ? "medium" : "compact";
}

/**
 * Whether the window is wide enough for the web's side bar. A medium window,
 * a tablet held upright or an unfolded foldable, keeps the phone's bar: the
 * side bar would leave its pages narrower than a phone's.
 */
export function sideBarShown(width: number): boolean {
  return widthClass(width) === "expanded";
}

/** The side bar's widths, the web rail's 14rem and its glyph-only 85px. */
export const RAIL = 224;
export const RAIL_NARROW = 85;

/** The web's page gutter, between the window's edge and the side bar. */
export const GUTTER = 16;

export function railWidth(labels: LabelMode): number {
  return labels === "glyph" ? RAIL_NARROW : RAIL;
}

/**
 * How wide each page is beside the side bar. The tab pager would otherwise
 * size its pages to the whole window, side bar included.
 */
export function sceneWidth(window: number, rail: number, startInset: number): number {
  return window - startInset - GUTTER - rail;
}

/** How far a list beside the side bar grows before it centres, wider than a form's column. */
export const WIDE_COLUMN = 1200;

/** The room beside a page next to the side bar, the web's page padding. */
export const WIDE_ROOM = 24;

/**
 * The room beside a page's content. Beside the side bar a list spreads across
 * the page as the web's lists do, while a form keeps the column a phone's
 * fields are made for. A frame that `fill`s, the pane beside the settings
 * tiles, spreads every page in it, as the web's settings fill their pane.
 */
export function pageRoom(frame: { wide: boolean; width: number; fill?: boolean }, gutter: number, spread: boolean): number {
  if (!frame.wide) return sideRoom(frame.width, gutter);
  return sideRoom(frame.width, WIDE_ROOM, spread || frame.fill ? WIDE_COLUMN : COLUMN);
}

/**
 * The size of each page beside the side bar. The pager would size it to the
 * whole window, and with no bar below it the page would run under the
 * system's navigation bar.
 */
export function sceneBox(wide: boolean, width: number, bottomInset: number): { width: number; paddingBottom: number } | undefined {
  return wide ? { width, paddingBottom: bottomInset } : undefined;
}

/** The web's side panel, 28rem at the window's end edge. */
export const PANEL = 448;

export function panelWidth(window: number): number {
  return Math.min(PANEL, window - 2 * GUTTER);
}

/**
 * Returns the widest a menu held against a button's end edge may grow: across
 * the screen to the gutter on the far side. The menu is only as wide as its
 * longest label, so a wide screen does not stretch it.
 */
export function menuRoom(window: number, offset: number, gutter: number): number {
  return window - offset - gutter;
}
