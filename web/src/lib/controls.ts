// Copied verbatim from GlimStone 2.6.0, reference/controls.ts.
// Do not edit here: change it in the design language repo and copy again.
// https://github.com/junkerderprovinz/glimstone
// The label engine: how much of a control's identity is shown, its text, its
// glyph, or both. Like the shape and motion engines it turns one setting into
// attributes on the document root, and components pick the answer up from CSS.
//
// The file has no framework dependency, since an adopting app copies it whole;
// a React app wraps it in a small hook.

/**
 * The four modes.
 *
 * 'text'      label only, no glyph.
 * 'textGlyph' glyph beside the label, the default and the look an app has
 *             before the setting exists.
 * 'glyph'     glyph only. The label stays as the accessible name and the hover
 *             bubble.
 * 'reactive'  glyph only at rest, the words returning on hover and focus.
 *
 * 'reactive' moves nothing on the page because every control already reserves
 * its label's width through the width stages below. Without the stages it
 * would reflow the interface under the pointer.
 */
export type LabelMode = 'text' | 'textGlyph' | 'glyph' | 'reactive';

export const LABEL_MODES: LabelMode[] = ['text', 'textGlyph', 'glyph', 'reactive'];

/**
 * Whether a mode hides the label from view. Both hiding modes keep the
 * accessible name and the hover bubble. Call sites use this rather than
 * comparing against 'glyph', so a new hiding mode is added in one place.
 */
export function hidesLabel(mode: LabelMode): boolean {
  return mode === 'glyph' || mode === 'reactive';
}

/**
 * The surfaces that each carry their own mode. A rail reduced to glyphs is a
 * layout decision, a button reduced to glyphs only a density preference, so one
 * switch for both would force a question the user never asked.
 *
 * 'buttons':   action buttons throughout the app.
 * 'sidebar':   the navigation rail.
 * 'tabs':      tab strips inside pages.
 * 'bottombar': the bar that replaces the rail in a phone layout.
 */
export type ControlAxis = 'buttons' | 'sidebar' | 'tabs';

/**
 * Only an app with a phone layout has a bar, so its axis has a type of its own
 * and stays out of CONTROL_AXES. An app without a bar never lists a row that
 * changes nothing, and state it keys by ControlAxis keeps compiling.
 */
export type BarAxis = 'bottombar';

/** Every axis the engine can store and apply. */
export type LabelAxis = ControlAxis | BarAxis;

/** The axes every adopting app has. */
export const CONTROL_AXES: ControlAxis[] = ['buttons', 'sidebar', 'tabs'];

/**
 * An app with a bar appends this to its label settings, explaining that the
 * row only affects the phone layout, and passes it to applyStoredLabelModes.
 */
export const BOTTOM_BAR_AXIS: BarAxis = 'bottombar';

/** Per-axis storage keys. Prefix them per app the way `bv-shape` is prefixed. */
const STORAGE_KEY: Record<LabelAxis, string> = {
  buttons: 'glim-labels-buttons',
  sidebar: 'glim-labels-sidebar',
  tabs: 'glim-labels-tabs',
  bottombar: 'glim-labels-bottombar',
};

const ATTRIBUTE: Record<LabelAxis, string> = {
  buttons: 'data-labels-buttons',
  sidebar: 'data-labels-sidebar',
  tabs: 'data-labels-tabs',
  bottombar: 'data-labels-bottombar',
};

/** The default for every axis, so adding the setting changes no interface. */
export const DEFAULT_LABEL_MODE: LabelMode = 'textGlyph';

function isLabelMode(v: unknown): v is LabelMode {
  return typeof v === 'string' && (LABEL_MODES as string[]).includes(v);
}

/** The stored preference for one axis, defaulting when unset or corrupt. */
export function getLabelMode(axis: LabelAxis): LabelMode {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY[axis]);
  } catch {
    // Private windows and blocked site data throw here instead of returning null.
  }
  return isLabelMode(stored) ? stored : DEFAULT_LABEL_MODE;
}

/**
 * Sets the attribute the stylesheet keys off, validating first, so a caller
 * can pass an unvalidated value straight out of storage.
 */
export function applyLabelMode(axis: LabelAxis, mode: LabelMode | string | undefined): void {
  document.documentElement.setAttribute(
    ATTRIBUTE[axis],
    isLabelMode(mode) ? mode : DEFAULT_LABEL_MODE,
  );
}

/** Persists the choice and applies it at once. */
export function setLabelMode(axis: LabelAxis, mode: LabelMode): void {
  try {
    localStorage.setItem(STORAGE_KEY[axis], mode);
  } catch {
    // The choice still applies for this session.
  }
  applyLabelMode(axis, mode);
}

/**
 * Call at boot from the app root, before first render, or a reload in a
 * non-default mode opens in `textGlyph` and snaps over. An app with a bar
 * passes [BOTTOM_BAR_AXIS].
 */
export function applyStoredLabelModes(extraAxes: LabelAxis[] = []): void {
  for (const axis of [...CONTROL_AXES, ...extraAxes]) applyLabelMode(axis, getLabelMode(axis));
}

// Width stages. A control keeps the same width in all four modes so switching
// never reflows the page, which means the width comes from the label, present
// in every mode at least as the accessible name. A stage is a pure function of
// the label, known before first paint, so no control has to measure itself.
//
// The current language decides the stage: a label can grow 3.4 times across
// locales ("Clear" is "Kijelölés törlése" in Hungarian), and one global stage
// would make every English interface pay for the longest translation.

export type WidthStage = 'xs' | 'sm' | 'md' | 'lg';

export const WIDTH_STAGES: WidthStage[] = ['xs', 'sm', 'md', 'lg'];

/**
 * Upper bounds in visual units, where a CJK or fullwidth character counts as
 * two. They come from one app's 80 button labels across 42 locales; an app with
 * a very different vocabulary should derive its own.
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

/** The stage a label belongs to. */
export function widthStage(label: string): WidthStage {
  const w = labelWidth(label);
  for (const [stage, max] of STAGE_MAX) {
    if (w <= max) return stage;
  }
  return 'lg';
}

// The glyph, its gap and the control's padding come to about eight units. A
// derived stage is only a floor, but groupStage applies an exact width, so a
// label at the top of `md` would otherwise render wider than `md`. Blanks keep
// the padding in the same arithmetic as the label.
const GROUP_CHROME = '        ';

/**
 * The stage a set of labels shares: the one the longest of them needs. Two
 * controls rendered by different components, such as two buttons in one card,
 * each compute it from the same labels and agree in every language without a
 * prop between them.
 */
export function groupStage(labels: string[]): WidthStage {
  let widest: WidthStage = 'xs';
  for (const label of labels) {
    const stage = widthStage(label + GROUP_CHROME);
    if (WIDTH_STAGES.indexOf(stage) > WIDTH_STAGES.indexOf(widest)) widest = stage;
  }
  return widest;
}

// The stylesheet's side of the contract:
//
//   --btn-w-xs / --btn-w-sm / --btn-w-md / --btn-w-lg
//       min-width floors for a derived stage, exact widths for a group stage.
//
//   --reactive-chars
//       set inline per control from `labelWidth(label)`, read by the reveal
//       rule as `max-width: calc(var(--reactive-chars) * 0.62em + <padding>)`.
//       `ch` measures the "0" glyph, narrower than the average letter, so a
//       `ch` cap clips long labels.
//
// A control in a hiding mode sets `gap: 0`, because a zero-width label is still
// a flex item and the gap would push the glyph off-centre.
