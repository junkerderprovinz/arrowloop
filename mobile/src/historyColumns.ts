import { GUTTER, pageRoom } from "./layout.ts";

/** The file log's fixed columns beside the side bar, the web's widths. */
export const FILE_COLUMNS = { what: 200, when: 128, job: 128, size: 64 };

/**
 * The run list's columns beside the side bar. State is wider than the web's,
 * since the phone has no columns for the conflicts and the files left for
 * later and shows them as badges there, wrapping.
 */
export const RUN_COLUMNS = { state: 160, took: 72, when: 128 };

/** space.md between two cells of a row. */
const GAP = 12;

/** The least the growing cell, the path or the job, keeps before a row stacks instead. */
const GROW_MIN = 120;

type Frame = { wide: boolean; width: number };

/** The width of a list row beside the side bar: the page less the list's side room and the card's padding. */
export function rowWidth(frame: Frame): number {
  return frame.width - 2 * pageRoom(frame, GUTTER, true) - 2 * GUTTER;
}

function fits(frame: Frame, columns: Record<string, number>): boolean {
  const fixed = Object.values(columns);
  const needed = fixed.reduce((sum, w) => sum + w, 0) + GROW_MIN + GAP * fixed.length;
  return frame.wide && rowWidth(frame) >= needed;
}

/** Whether the file log draws its rows across in columns, as the web does, or stacked as on a phone. */
export function filesFit(frame: Frame): boolean {
  return fits(frame, FILE_COLUMNS);
}

/** Whether the run list draws its rows across in columns. */
export function runsFit(frame: Frame): boolean {
  return fits(frame, RUN_COLUMNS);
}
