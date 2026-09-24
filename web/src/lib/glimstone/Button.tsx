import type { CSSProperties, ReactNode, Ref } from "react";
import { hueVars, rainbowAt } from "../appearance";
import { hidesLabel, labelWidth, widthStage, type WidthStage } from "../controls";
import { useLabelMode } from "./useLabelMode";
import { useTipBubble } from "./useTipBubble";
import { glyphFor } from "./glyphs";
import { IconClose } from "./glyphs";

// The one clickable control. Something you can click is a button and
// something you only read is a badge, since only a real <button> is reachable
// by keyboard.
//
// The component owns what a call site should not repeat: what is shown, from
// the shared "buttons" label axis; the width stage derived from the label; the
// label as accessible name and, in glyph mode, as the `.glim-bubble` tooltip
// rather than a native `title=`; and the colour engine position through
// `hueIndex`. A button without a glyph shows its text in every mode, since a
// row of blank squares cannot be identified.

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
export type ButtonTone = "accent" | "neutral" | "subtle" | "danger" | "warn";

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
 *           ordinary reactive button, because it grows on hover.
 */
export type ButtonVariant = "default" | "chip" | "icon";

// `danger` and `warn` put the solid status tokens under `carbon-background`
// ink: in both themes the solid values sit at the opposite lightness to the
// background, so one ink reads on both.
const TONE_CLASS: Record<ButtonTone, string> = {
  accent: "bg-accent text-accentContrast hover:opacity-90",
  // Filled tones hover up their own ramp (rule 21). `--carbon-hover` is for
  // controls with no fill, and on the dark ramp it is darker than surface2.
  neutral: "bg-carbon-surface3 text-carbon-text hover:bg-carbon-hoverRaised",
  subtle: "bg-carbon-surface2 text-carbon-text hover:bg-carbon-surface3",
  danger: "bg-statusFailSolid text-carbon-background hover:opacity-90",
  warn: "bg-statusWarnSolid text-carbon-background hover:opacity-90",
};

export function Button({
  label,
  labelKey,
  glyph,
  onClick,
  tone = "neutral",
  variant = "default",
  disabled = false,
  type = "button",
  className = "",
  title,
  hueIndex,
  busy = false,
  autoFocus = false,
  stage: stageOverride,
  keepLabel = false,
  ref,
}: {
  /** The button's words, present in every mode: visible, or hidden but
   *  announced and shown as the tooltip. Keep it stable, since a label that
   *  changes while the button works would resize it; put changing state in
   *  `title`. */
  label: string;
  /** The translation key behind `label`, or `null` when the label is data such
   *  as a path. It picks the glyph by meaning (glyphFor), so the same verb
   *  wears the same symbol everywhere; an explicit `glyph` wins.
   *
   *  It is required so every call site answers "this key" or "none" instead of
   *  silently falling back to text in glyph mode. When the label branches, the
   *  key branches with it. */
  labelKey: string | null;
  /** Optional icon, overriding whatever `labelKey` would have chosen. Without
   *  either, glyph mode shows this button's text instead of an empty box. */
  glyph?: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  /** "chip" inside a pill, "icon" for a row action; see ButtonVariant. */
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  /** Extra explanation, and the place for anything that changes: the running
   *  state, or why the button is unavailable. It shows in the hover and focus
   *  bubble, joined with the label where the label is hidden, and still
   *  reaches a disabled button through useTipBubble's `wrap`. */
  title?: string;
  /** This button's own rainbow position, as on Badge. Usually unnecessary: a
   *  Card with a `hueIndex` rebinds `--accent` for everything inside it, and
   *  passing the card's own index changes nothing. Pass it only for a
   *  colour different from the card's, such as a row that owns its position. */
  hueIndex?: number;
  /** Forwarded to the underlying <button>, so a dialog can move focus to it. */
  ref?: Ref<HTMLButtonElement>;
  /** Shows a spinner in place of the glyph. Separate from `disabled`, since a
   *  caller may want one without the other. */
  busy?: boolean;
  /** For a dialog that opens with focus on one of its buttons. */
  autoFocus?: boolean;
  /** Forces a width stage instead of deriving one from the label, for two
   *  buttons rendered by different components that should match: pass
   *  `groupStage([labelA, labelB])` to both. Use it only for such a pair.
   *  Ignored in glyph and reactive mode, which take no stage. */
  stage?: WidthStage;
  /** Keeps the label visible in every mode, for a button whose label is
   *  content rather than a verb, such as a directory row in a folder browser.
   *  The glyph still shows beside it. */
  keepLabel?: boolean;
}) {
  const mode = useLabelMode("buttons");
  const chip = variant === "chip";
  const iconOnly = variant === "icon";
  // A chip always closes, so it has a glyph even when no call site passes one.
  const resolved = glyph ?? (labelKey ? glyphFor(labelKey) : undefined) ?? (chip ? <IconClose /> : undefined);
  const hasGlyph = !!resolved || busy;
  // A glyphless button shows its text in both hiding modes, and keepLabel
  // keeps the glyph beside the text when there is one.
  const effective = chip
    ? "glyph"
    : keepLabel
      ? hasGlyph
        ? "textGlyph"
        : "text"
      : hidesLabel(mode) && !hasGlyph
        ? "text"
        : mode;
  const reactive = effective === "reactive";
  // Reactive words arrive on hover, a CSS state, so this render treats reactive
  // as a hiding mode.
  const showText = effective !== "glyph" && !reactive;
  const showGlyph = effective !== "text" && hasGlyph;

  // Text and text-with-glyph take the stage from the label in the current
  // language, so switching between them never reflows. In the hiding modes a
  // button hugs its glyph, and a reactive one grows as its words arrive. A chip
  // is sized by its glyph to fit its pill, and the icon variant is a square
  // only in glyph mode.
  const stage = chip
    ? "glim-btn-chip"
    : effective === "glyph"
      ? iconOnly
        ? "glim-btn-icon"
        : ""
      : reactive
        ? ""
        : STAGE_CLASS[stageOverride ?? widthStage(label)];

  // In glyph mode the tooltip carries the label joined with the title, once if
  // they are the same words. Reactive counts as showing text, since hovering
  // reveals the words and a bubble would repeat them.
  const tip =
    (showText || reactive
      ? title
      : [...new Set([label, title].filter(Boolean))].join(" · ")) || undefined;
  // A disabled reactive button takes no hover, so its words never reveal and
  // the bubble is what explains it.
  const tooltip = useTipBubble(reactive && !disabled ? undefined : tip, disabled);

  const hueOn = hueIndex !== undefined;
  // The reveal's ceiling in the label's visual units (see `.glim-label-reactive`
  // in reference/tokens.css).
  const hueStyle = {
    ...(hueOn ? (hueVars(rainbowAt(hueIndex)) as CSSProperties) : {}),
    ...(reactive ? ({ "--reactive-chars": labelWidth(label) } as CSSProperties) : {}),
    // An explicit stage promises that two buttons match, so it is an exact
    // width; a derived stage stays a floor a long label may overhang.
    ...(stageOverride && stage ? ({ width: `var(--btn-w-${stageOverride})` } as CSSProperties) : {}),
  };

  return (
    <>
      {/* `wrap` boxes only a disabled button with a tip, since a disabled
          <button> emits no mouse events. */}
      {tooltip.wrap(
        <button
          ref={mergeRefs(ref, tooltip.ref)}
          type={type}
          onClick={onClick}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={tooltip.describedBy}
          {...tooltip.handlers}
          style={Object.keys(hueStyle).length ? hueStyle : undefined}
          className={`glim-btn ${stage} ${chip ? "" : TONE_CLASS[tone]}${hueOn ? " glim-hue" : ""}${reactive ? " glim-reactive" : ""} ${className}`.trim()}
        >
          {showGlyph && (
            <span className="glim-btn-glyph">
              {busy ? (
                <span
                  className="h-3.5 w-3.5 rounded-full border-2 border-t-transparent animate-spin inline-block"
                  style={{ borderColor: "currentColor", borderTopColor: "transparent" }}
                />
              ) : (
                resolved
              )}
            </span>
          )}
          {/* Hidden, never removed, so the button keeps its accessible name.
              Reactive collapses the label's box until hover opens it. */}
          <span className={showText ? "glim-btn-label" : reactive ? "glim-label-reactive" : "sr-only"}>
            {label}
          </span>
        </button>,
      )}
      {tooltip.bubble}
    </>
  );
}

/**
 * Feeds one element to both the caller's `ref`, a callback or an object, and
 * the tooltip's, which places the bubble against it.
 */
function mergeRefs(
  outer: Ref<HTMLButtonElement> | undefined,
  inner: (el: HTMLElement | null) => void,
): (el: HTMLButtonElement | null) => void {
  return (el) => {
    inner(el);
    if (typeof outer === "function") outer(el);
    else if (outer) outer.current = el;
  };
}
