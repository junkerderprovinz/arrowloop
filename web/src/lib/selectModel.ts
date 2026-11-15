// What the framework selects share: the list model, the trigger's classes, the
// placement, the wheel, closing on a page move and the shake. The glyph type is
// the framework's own, a ReactNode in React and a component in Vue.

import { stepIndex } from "./selectScroll.ts";

export interface SelectChoice<T extends string = string, G = unknown> {
  value: T;
  label: string;
  /** A mark before the label, in the list and on the trigger. */
  glyph?: G;
  disabled?: boolean;
}

/** A row that opens a list of its own beside it, for a list too long to show flat. */
export interface SelectSubmenu<T extends string = string, G = unknown> {
  label: string;
  glyph?: G;
  options: SelectChoice<T, G>[];
}

export type SelectEntry<T extends string = string, G = unknown> = SelectChoice<T, G> | SelectSubmenu<T, G>;

/** A run of rows, set off from its neighbours by a hairline and named by its heading where it has one. */
export interface SelectRun<T extends string = string, G = unknown> {
  heading?: string;
  entries: SelectEntry<T, G>[];
}

/**
 * How wide the trigger is. `fill` takes its line like a text field. `steady`
 * is as wide as the longest option, so choosing never moves what stands beside
 * it. `squeeze` is `steady` where there is room and narrower where there is
 * not, down to a few letters and an ellipsis, for a table that has to fit its
 * card. `hug` fits the value on show, for a list cell too narrow for the
 * longest option. The open list shows every option in full in all four.
 */
export type SelectWidth = "fill" | "steady" | "squeeze" | "hug";

/**
 * How big the trigger is. `field` stands among text fields at their height and
 * type. `row` keeps that height in small type, for a list or table row and
 * beside a compact field. `inset` sits inside another field, such as a search
 * box's scope, and is smaller than one.
 */
export type SelectSize = "field" | "row" | "inset";

const WIDTH_CLASS: Record<SelectWidth, string> = {
  fill: "glim-select",
  steady: "glim-select glim-select--steady",
  squeeze: "glim-select glim-select--squeeze",
  hug: "glim-select glim-select--hug",
};

const SIZE_CLASS: Record<SelectSize, string> = {
  field: "",
  row: "glim-select-trigger--row",
  inset: "glim-select-trigger--inset",
};

/** The box around label and trigger. */
export function selectRootClass(width: SelectWidth): string {
  return WIDTH_CLASS[width];
}

/** The trigger's classes. `wrap` lets a long value run onto a second line, for one whose end says as much as its start, such as a path. */
export function selectTriggerClass(size: SelectSize, wrap: boolean): string {
  return ["glim-select-trigger", SIZE_CLASS[size], wrap && "glim-select-trigger--wrap"].filter(Boolean).join(" ");
}

export function selectContentClass(glyphs: boolean): string {
  return `glim-select-content glim-fade${glyphs ? " glim-select-content--glyphs" : ""}`;
}

/**
 * Which rows an open list draws. `menu` takes a context menu's, so an app with
 * both shows one kind of menu row.
 */
export type SelectRows = "list" | "menu";

export interface SelectRowParts {
  content: string;
  item: string;
  /** The glyph's room, or null where no row of a list has one. A menu row keeps it always. */
  glyph: string | null;
  label: string;
  check: string;
  caret: string;
  heading: string;
}

/** The classes of an open list and its rows. */
export function selectRowParts(rows: SelectRows, glyphs: boolean): SelectRowParts {
  const content = selectContentClass(glyphs);
  return rows === "menu"
    ? {
        content: `${content} glim-select-content--menu`,
        item: "glim-menu-item",
        glyph: "glim-menu-glyph",
        label: "glim-menu-label",
        check: "glim-menu-end glim-menu-tick",
        caret: "glim-menu-end glim-menu-caret",
        heading: "glim-menu-head",
      }
    : {
        content,
        item: "glim-select-item",
        glyph: glyphs ? "glim-select-glyph" : null,
        label: "glim-select-label",
        check: "glim-select-check",
        caret: "glim-select-caret",
        heading: "glim-select-heading",
      };
}

/** A field defaults to `fill`, the smaller sizes to `steady`. */
export function defaultWidth(size: SelectSize): SelectWidth {
  return size === "field" ? "fill" : "steady";
}

// Below the trigger on the side its text starts from; where that does not fit,
// ending where the trigger ends or above it.
export const SELECT_POSITIONING: {
  placement: "bottom-start";
  flip: ("top-start" | "bottom-end" | "top-end")[];
  gutter: number;
  overflowPadding: number;
  fitViewport: boolean;
} = {
  placement: "bottom-start",
  flip: ["top-start", "bottom-end", "top-end"],
  gutter: 4,
  overflowPadding: 8,
  fitViewport: true,
};

export function isSubmenu<T extends string, G>(e: SelectEntry<T, G>): e is SelectSubmenu<T, G> {
  return "options" in e;
}

/** Every option in list order, submenus opened in place. */
export function flattenRuns<T extends string, G>(runs: SelectRun<T, G>[]): SelectChoice<T, G>[] {
  return runs.flatMap((g) => g.entries.flatMap((e) => (isSubmenu(e) ? e.options : [e])));
}

/** A list with a submenu needs the menu machine, since a listbox cannot nest. */
export function hasSubmenu<T extends string, G>(runs: SelectRun<T, G>[]): boolean {
  return runs.some((g) => g.entries.some(isSubmenu));
}

export function pageDir(): "ltr" | "rtl" {
  return typeof document !== "undefined" && document.documentElement.dir === "rtl" ? "rtl" : "ltr";
}

/**
 * The row a list with submenus opens on: the value in force, or the row of the
 * submenu that holds it, as a native select does. `subId` names a submenu's
 * trigger by its run and entry index.
 */
export function homeRow<T extends string, G>(
  runs: SelectRun<T, G>[],
  value: T | null,
  subId: (run: number, entry: number) => string,
): string | null {
  for (const [gi, g] of runs.entries()) {
    for (const [ei, e] of g.entries.entries()) {
      if (isSubmenu(e) ? e.options.some((o) => o.value === value) : e.value === value) {
        return isSubmenu(e) ? subId(gi, ei) : e.value;
      }
    }
  }
  return null;
}

/**
 * The words on the trigger. Under `steady` and `squeeze` every label stands in
 * one grid cell with only the chosen one visible, so the trigger is as wide as
 * the longest and does not move when the value does.
 */
export function faceLabels<T extends string, G>(
  all: SelectChoice<T, G>[],
  value: T | null,
  placeholder: string | undefined,
  width: SelectWidth,
): { text: string; labels: string[] } {
  const text = all.find((o) => o.value === value)?.label ?? placeholder ?? "";
  const stacked = width === "steady" || width === "squeeze";
  return { text, labels: stacked ? [...new Set([text, ...all.map((o) => o.label)])] : [text] };
}

/**
 * The value one wheel notch away, skipping disabled options and stopping at
 * both ends (rule 14), or undefined when there is nowhere to go. A value the
 * list does not carry steps onto the first option.
 */
export function wheelValue<T extends string, G>(all: SelectChoice<T, G>[], value: T | null, delta: 1 | -1): T | undefined {
  const at = all.findIndex((x) => x.value === value);
  if (at < 0) return all.find((x) => !x.disabled)?.value;
  let next = at;
  for (;;) {
    const candidate = stepIndex(all.length, next, delta);
    if (candidate === next) return undefined;
    next = candidate;
    const choice = all[next]!;
    if (!choice.disabled) return choice.value;
  }
}

/**
 * The option Home or End on a closed trigger opens the list on, the first or
 * the last one that can be chosen, or undefined for any other key. A native
 * select would choose that option at once and change the value unseen; the
 * select-only combobox pattern opens the list there instead.
 */
export function endOption<T extends string, G>(all: SelectChoice<T, G>[], key: string): T | undefined {
  const choosable = all.filter((x) => !x.disabled);
  if (key === "Home") return choosable[0]?.value;
  if (key === "End") return choosable.at(-1)?.value;
  return undefined;
}

/**
 * Closes an open list when a wheel or a finger moves the page past it, as a
 * resize does. Scroll events do not: the list follows its trigger, and a page
 * still gliding to a trigger that just took focus would close it as it opens.
 * Returns the cleanup.
 */
export function closeOnPageMove(close: () => void): () => void {
  const onMove = (e: Event) => {
    if (e.target instanceof Element && e.target.closest(".glim-select-content")) return;
    close();
  };
  const opts = { capture: true, passive: true };
  window.addEventListener("wheel", onMove, opts);
  window.addEventListener("touchmove", onMove, opts);
  window.addEventListener("resize", close);
  return () => {
    window.removeEventListener("wheel", onMove, opts);
    window.removeEventListener("touchmove", onMove, opts);
    window.removeEventListener("resize", close);
  };
}

/**
 * Shakes a control once, for a choice that failed and snapped back. The class
 * has to be gone for a whole frame before it comes back, or the animation does
 * not start again. Returns the cleanup.
 */
export function shake(el: HTMLElement): () => void {
  el.classList.remove("glim-shake");
  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(() => el.classList.add("glim-shake"));
  });
  const done = (e: AnimationEvent) => {
    if (e.target === el) el.classList.remove("glim-shake");
  };
  el.addEventListener("animationend", done);
  return () => {
    cancelAnimationFrame(outer);
    cancelAnimationFrame(inner);
    el.removeEventListener("animationend", done);
  };
}
