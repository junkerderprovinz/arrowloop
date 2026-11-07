// The text field and the row a control stands in ("A dropdown or a one-line
// field stands beside its label", rule 35).

/**
 * How wide a field is. `fill` takes its column. `short` holds a port or a time,
 * `medium` a word, `wide` a line of text, and `grow` takes what its row has left.
 */
export type FieldWidth = "fill" | "short" | "medium" | "wide" | "grow";

/** The class of a width, for a text field or any wrapper that carries one. */
export function fieldWidthClass(width: FieldWidth = "fill"): string {
  return width === "fill" ? "" : `glim-field--${width}`;
}

/** The classes of a text field or a text area. */
export function textFieldClass({ width, mono, area }: { width?: FieldWidth; mono?: boolean; area?: boolean }): string {
  return ["glim-input", area && "glim-input--area", mono && "glim-input--mono", fieldWidthClass(width)].filter(Boolean).join(" ");
}

/** Below this width a PathField's button shows its glyph alone and leaves the room to the path. */
export const PATH_ROOM_PX = 320;

const FIELD = 'input:not([type="hidden"]), textarea';
const PRESSABLE = '[role="switch"], [role="checkbox"], .glim-select-trigger';

/**
 * What a click on a row's label does, as a real label would: a field takes the
 * focus and a switch flips. A selector stays as it is, since no one segment is
 * the row's.
 */
export function pressRowControl(row: HTMLElement): void {
  const control = row.querySelector<HTMLElement>(`${FIELD}, ${PRESSABLE}`);
  if (control?.matches(FIELD)) control.focus();
  else control?.click();
}
