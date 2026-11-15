// The one clickable control, without a framework. Something you can click is a
// button and something you only read is a badge, since only a real <button> is
// reachable by keyboard.
//
// buttonView() decides what a call site should not repeat: what is shown, from
// the shared "buttons" label axis; the width stage derived from the label; the
// label as accessible name and, where it is hidden, as the `.glim-bubble`
// tooltip; and the colour engine position. A button without a glyph shows its
// text in every mode, since a row of blank squares cannot be identified.

import { hueVars } from "./appearance.ts";
import { hidesLabel, labelWidth, widthStage, type LabelMode, type WidthStage } from "./controls.ts";

const STAGE_CLASS: Record<WidthStage, string> = {
  xs: "glim-btn-xs",
  sm: "glim-btn-sm",
  md: "glim-btn-md",
  lg: "glim-btn-lg",
};

/**
 * The fills a button can take. A background written in `className` beside a
 * tone wins or loses by stylesheet order, so a control that needs a surface
 * the table lacks gets a new tone here instead.
 */
export type ButtonTone = "accent" | "neutral" | "subtle" | "ok" | "danger" | "warn";

/**
 * "default" the ordinary action button.
 * "chip"    the small remove control inside a pill, such as a selected path or
 *           an exclusion line. It shows its glyph in every mode and takes no
 *           width stage, which would burst the pill; its label stays the
 *           accessible name and the hover text.
 * "icon"    a single-purpose action in a row of siblings: copy, reset, undo,
 *           edit, delete. It follows the label mode like any button and only
 *           changes shape: where the mode hides words it is a square at the
 *           button height instead of hugging its glyph. Reactive stays an
 *           ordinary reactive button, because its words open on hover.
 */
export type ButtonVariant = "default" | "chip" | "icon";

/** `key` is the second height, for the button a surface exists for (rule 19). */
export type ButtonSize = "normal" | "key";

// The fills live in tokens.css (`.glim-btn--accent` and its siblings). The two
// surface tones also take the accent tint of rule 40.
const TONE_CLASS: Record<ButtonTone, string> = {
  accent: "glim-btn--accent",
  neutral: "glim-btn-neutral glim-btn--neutral",
  subtle: "glim-btn-subtle glim-btn--subtle",
  ok: "glim-btn--ok",
  danger: "glim-btn--danger",
  warn: "glim-btn--warn",
};

export interface ButtonInput {
  /** The current mode of the "buttons" label axis. */
  mode: LabelMode;
  label: string;
  /** Whether a glyph will show: one the caller passed or resolved, the busy
   *  spinner, or a chip's close mark. */
  hasGlyph: boolean;
  tone: ButtonTone;
  variant: ButtonVariant;
  disabled: boolean;
  keepLabel: boolean;
  /** Its glyph alone in a square in every label mode, where the words have no room. */
  compact?: boolean;
  size?: ButtonSize;
  title?: string;
  hueIndex?: number;
  stage?: WidthStage;
}

export interface ButtonView {
  showGlyph: boolean;
  /** The class of the span that holds the label: shown, revealed on hover, or
   *  screen-reader text. The label is hidden, never removed, so the button
   *  keeps its accessible name. */
  labelClass: string;
  /** The classes of the <button>, before any the call site adds. */
  className: string;
  style: Record<string, string> | undefined;
  /** What the hover and focus bubble says, or undefined for no bubble. */
  tip: string | undefined;
  /** Whether hover and focus should call takePageHue, the tint of rule 40. */
  pageHue: boolean;
}

export function buttonView(b: ButtonInput): ButtonView {
  const chip = b.variant === "chip";
  const compact = !!b.compact && b.hasGlyph;
  const iconOnly = b.variant === "icon" || compact;
  // A glyphless button shows its text in both hiding modes, and keepLabel
  // keeps the glyph beside the text when there is one.
  const effective: LabelMode = chip || compact
    ? "glyph"
    : b.keepLabel
      ? b.hasGlyph
        ? "textGlyph"
        : "text"
      : hidesLabel(b.mode) && !b.hasGlyph
        ? "text"
        : b.mode;
  const reactive = effective === "reactive";
  // Reactive words arrive on hover, a CSS state, so it counts as a hiding mode here.
  const showText = effective !== "glyph" && !reactive;

  // Every mode that shows words takes the stage from the label in the current
  // language, reactive included, so its words open inside a box that was
  // always their size and the row never moves under the pointer. In glyph mode
  // a button hugs its glyph. A chip is sized by its glyph to fit its pill, and
  // the icon variant is a square only in glyph mode.
  const stage = chip
    ? "glim-btn-chip"
    : effective === "glyph"
      ? iconOnly
        ? "glim-btn-icon"
        : ""
      : STAGE_CLASS[b.stage ?? widthStage(b.label, b.hasGlyph)];

  // Where the label is hidden the tooltip carries it joined with the title,
  // once if they are the same words. Reactive counts as showing text, since
  // hovering reveals the words and a bubble would repeat them; a disabled
  // reactive button takes no hover, so there the bubble is what explains it.
  const tip =
    (showText || reactive ? b.title : [...new Set([b.label, b.title].filter(Boolean))].join(" · ")) || undefined;

  const hueOn = b.hueIndex !== undefined;
  const style: Record<string, string> = {
    ...(hueOn ? hueVars(b.hueIndex!) : {}),
    // The reveal's ceiling in the label's visual units (`.glim-label-reactive`).
    ...(reactive ? { "--reactive-chars": String(labelWidth(b.label)) } : {}),
    // An explicit stage promises that two buttons match, so it is an exact
    // width; a derived stage stays a floor a long label may overhang.
    ...(b.stage && stage ? { width: `var(--btn-w-${b.stage})` } : {}),
  };

  return {
    showGlyph: effective !== "text" && b.hasGlyph,
    labelClass: showText ? "glim-btn-label" : reactive ? "glim-label-reactive" : "glim-sr-only",
    className: `glim-btn ${stage} ${chip ? "" : TONE_CLASS[b.tone]}${b.size === "key" ? " glim-btn-key" : ""}${hueOn ? " glim-hue" : ""}${reactive ? " glim-reactive" : ""}`,
    style: Object.keys(style).length ? style : undefined,
    tip: reactive && !b.disabled ? undefined : tip,
    // The surface tones carry rule 40's tint; a button with its own palette
    // position keeps that colour.
    pageHue: !hueOn && !chip && (b.tone === "neutral" || b.tone === "subtle"),
  };
}
