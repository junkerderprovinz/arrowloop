// Copied verbatim from GlimStone 1.10.0, reference/controls.ts.
// Do not edit here: change it in the design language repo and copy again.
// https://github.com/junkerderprovinz/glimstone
// How much of a control's identity is shown: its text, its glyph, or both.
//
// This is the label engine. Like the shape and motion engines it turns one
// setting into attributes on the document root, and every component picks the
// answer up from CSS it already reads — nothing downstream is told about the
// change, and no component decides for itself what "glyph mode" means.
//
// This file stays free of any UI framework on purpose: it's the piece an
// adopting app copies wholesale, and a design language shouldn't arrive with a
// framework attached. A React app wraps it in a small hook; anything else calls
// the functions directly.

/**
 * The four modes.
 *
 * 'text'      — label only, no glyph.
 * 'textGlyph' — glyph beside the label. The default, because it is what an app
 *               looks like before the setting exists, and nobody's interface
 *               should change merely because a preference was added.
 * 'glyph'     — glyph only. The label survives as the accessible name and as
 *               the hover bubble, never as nothing.
 * 'reactive'  — glyph only at rest, words returning on hover and on focus.
 *
 * Why 'reactive' can exist at all, and why it is last: it costs no layout.
 * Every control already reserves its LABEL's width in glyph mode (see the
 * width stages below), so the box is wide enough for the words before they
 * arrive, and revealing them moves nothing on the page. Without the stages
 * this mode would reflow the interface under the pointer, which is the exact
 * thing the stages exist to prevent — build them first, or don't offer this
 * mode.
 */
export type LabelMode = 'text' | 'textGlyph' | 'glyph' | 'reactive';

export const LABEL_MODES: LabelMode[] = ['text', 'textGlyph', 'glyph', 'reactive'];

/**
 * Whether a mode hides the label from view. Both hiding modes keep the
 * accessible name and the hover bubble; they differ only in whether the words
 * themselves come back.
 *
 * A predicate rather than `mode === 'glyph'` written out at each call site.
 * That comparison lived at eleven places in the first app to build this, and
 * every one of them would have had to learn about the fourth mode
 * independently — the kind of spot where a new enum value gets half-adopted
 * and nobody notices until one strip renders wrong.
 */
export function hidesLabel(mode: LabelMode): boolean {
  return mode === 'glyph' || mode === 'reactive';
}

/**
 * THREE INDEPENDENT AXES, not one global switch.
 *
 * The same answer is rarely right for all three surfaces: a navigation rail
 * reduced to glyphs is a layout decision — the rail gets narrower and the page
 * gets wider — while a button reduced to glyphs is only a density preference.
 * Tying them together forces a user who wants a compact rail to also accept
 * unlabelled buttons, which is a different question they were never asked.
 *
 * 'buttons' — action buttons throughout the app.
 * 'sidebar' — the navigation rail.
 * 'tabs'    — tab strips inside pages.
 *
 * Kept as a list rather than three copies of the same code, so a fourth
 * surface is one entry and a settings card can iterate instead of repeating
 * itself.
 */
export type ControlAxis = 'buttons' | 'sidebar' | 'tabs';

export const CONTROL_AXES: ControlAxis[] = ['buttons', 'sidebar', 'tabs'];

/** Per-axis storage keys. Prefix them per app the way `bv-shape` is prefixed. */
const STORAGE_KEY: Record<ControlAxis, string> = {
  buttons: 'glim-labels-buttons',
  sidebar: 'glim-labels-sidebar',
  tabs: 'glim-labels-tabs',
};

const ATTRIBUTE: Record<ControlAxis, string> = {
  buttons: 'data-labels-buttons',
  sidebar: 'data-labels-sidebar',
  tabs: 'data-labels-tabs',
};

/**
 * DEFAULT is 'textGlyph' for every axis: the look an app already has. Same
 * reasoning the motion engine gives for defaulting to 'full' — this axis is
 * something a user dials, not a fallback they have to opt into.
 */
export const DEFAULT_LABEL_MODE: LabelMode = 'textGlyph';

function isLabelMode(v: unknown): v is LabelMode {
  return typeof v === 'string' && (LABEL_MODES as string[]).includes(v);
}

/** The stored preference for one axis, defaulting when unset or corrupt. */
export function getLabelMode(axis: ControlAxis): LabelMode {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY[axis]);
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null; the default is a perfectly good answer there.
  }
  return isLabelMode(stored) ? stored : DEFAULT_LABEL_MODE;
}

/**
 * Sets the attribute the stylesheet keys off, validating first, so a caller
 * can pass an unvalidated value straight out of storage.
 */
export function applyLabelMode(axis: ControlAxis, mode: LabelMode | string | undefined): void {
  document.documentElement.setAttribute(
    ATTRIBUTE[axis],
    isLabelMode(mode) ? mode : DEFAULT_LABEL_MODE,
  );
}

/** Persists the choice and applies it immediately — no separate save step. */
export function setLabelMode(axis: ControlAxis, mode: LabelMode): void {
  try {
    localStorage.setItem(STORAGE_KEY[axis], mode);
  } catch {
    // Not being able to remember the choice is no reason to refuse it for
    // this session.
  }
  applyLabelMode(axis, mode);
}

/**
 * Called at boot, before first render, so the layout never flashes in one mode
 * and settles into another.
 *
 * This step is easy to leave out and hard to see missing: the setting works,
 * the picker works, and only a reload in a non-default mode shows the app
 * opening in `textGlyph` and snapping over. The first app to build this axis
 * shipped exactly that bug — every OTHER engine's boot call was present, and
 * this one had been added to the settings page instead of to the root.
 */
export function applyStoredLabelModes(): void {
  for (const axis of CONTROL_AXES) applyLabelMode(axis, getLabelMode(axis));
}

// ---------------------------------------------------------------------------
// Width stages
//
// The requirement that makes this engine usable: a control keeps the SAME
// width in all four modes, so switching mode never reflows the page. The width
// therefore cannot come from what is currently rendered — a lone glyph is
// narrow — it has to come from the LABEL, which is present in every mode even
// when it is only the accessible name.
//
// Why stages rather than each control measuring its own text: measurement
// happens in the browser, after layout, which is both untestable and a source
// of jitter. A stage is a pure function of the label, known before first
// paint, and it gives the tidy aligned look that a mixed set of hand-measured
// widths does not.
//
// Why the CURRENT language decides the stage, measured rather than assumed:
// across a large locale set the same label grows by up to 3.4x ("Clear"
// becomes "Kijelölés törlése" in Hungarian, "Show" becomes "Megjelenítés").
// Pinning one global stage per control would make every English and Chinese
// interface pay for the longest translation, permanently. Deriving the stage
// from the active language keeps each language tidy on its own terms, and the
// width then changes when the LANGUAGE changes — a reload-level event, not
// something that happens while someone is looking at a mode selector.
// ---------------------------------------------------------------------------

export type WidthStage = 'xs' | 'sm' | 'md' | 'lg';

export const WIDTH_STAGES: WidthStage[] = ['xs', 'sm', 'md', 'lg'];

/**
 * Upper bounds in "visual units", where a CJK/fullwidth character counts as
 * two. These four came out of the real distribution of one app's 80 button
 * labels across 42 locales; an adopting app with a very different vocabulary
 * should re-derive them from its own labels rather than inherit these on
 * faith. Four stages is the number that mattered — enough that a short label
 * is not padded to a paragraph's width, few enough that a row still aligns.
 */
export const STAGE_MAX: [WidthStage, number][] = [
  ['xs', 10],
  ['sm', 16],
  ['md', 26],
  ['lg', Infinity],
];

/**
 * Visual width of a label: CJK and other fullwidth characters count double,
 * since they occupy roughly two Latin character cells.
 */
export function labelWidth(label: string): number {
  let total = 0;
  for (const ch of label) {
    const code = ch.codePointAt(0) ?? 0;
    const fullwidth =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    total += fullwidth ? 2 : 1;
  }
  return total;
}

/**
 * The stage a label belongs to. Pure, so it is testable without a DOM and
 * gives the same answer during first paint as it does later.
 */
export function widthStage(label: string): WidthStage {
  const w = labelWidth(label);
  for (const [stage, max] of STAGE_MAX) {
    if (w <= max) return stage;
  }
  return 'lg';
}

/**
 * Padding for the things a stage table cannot see.
 *
 * `widthStage` measures TEXT, but a rendered control also carries a glyph, the
 * gap beside it and its own horizontal padding — about eight units at the
 * scale these bounds are calibrated to. For the ordinary case that gap does
 * not matter, because a derived stage is a FLOOR and a slightly wide label
 * simply overhangs it.
 *
 * It matters for `groupStage`, where the result is applied as an EXACT width.
 * Left unpadded, a label landing at the top of `md` renders wider than `md`,
 * so the pair it was supposed to match would be the one thing it does not do.
 *
 * Eight blanks rather than a number, so it flows through the same
 * labelWidth/widthStage pair as everything else instead of duplicating their
 * arithmetic somewhere it can drift.
 */
const GROUP_CHROME = '        ';

/**
 * The stage a set of labels shares: the one the LONGEST of them needs.
 *
 * For controls that belong together visually but are rendered by different
 * components, so neither can see the other's label — two buttons side by side
 * in one card, where one lands on `sm` and the other on `md`.
 *
 * Both components compute this from the SAME labels rather than one passing a
 * width to the other, so they agree in every language without a prop threaded
 * through the markup between them, and they keep agreeing when one of the two
 * words is retranslated.
 */
export function groupStage(labels: string[]): WidthStage {
  let widest: WidthStage = 'xs';
  for (const label of labels) {
    const stage = widthStage(label + GROUP_CHROME);
    if (WIDTH_STAGES.indexOf(stage) > WIDTH_STAGES.indexOf(widest)) widest = stage;
  }
  return widest;
}

// ---------------------------------------------------------------------------
// What the stylesheet has to provide
//
// The engine sets attributes; the tokens below are the contract the app's own
// CSS fulfils. Four width tokens, one per stage, plus the reveal geometry for
// the reactive mode:
//
//   --btn-w-xs / --btn-w-sm / --btn-w-md / --btn-w-lg
//       min-width floors for a derived stage, exact widths for a group stage.
//
//   --reactive-chars
//       set inline per control from `labelWidth(label)`, read by the reveal
//       rule as `max-width: calc(var(--reactive-chars) * 0.62em + <padding>)`.
//       Use `em`, not `ch`: `ch` measures the "0" glyph, which is narrower
//       than the average letter in most faces, so a `ch`-based cap clips long
//       labels — found the hard way, on a 47-unit German label.
//
// A control in a hiding mode drops the gap between glyph and label (`gap: 0`).
// A zero-width label is still a flex item, so the gap survives it and the
// glyph sits visibly off-centre in what is supposed to be a square button.
// ---------------------------------------------------------------------------
