import type { ButtonHTMLAttributes, FocusEvent, MouseEvent, ReactNode, Ref } from "react";
import { useSyncExternalStore } from "react";
import { buttonView, type ButtonSize, type ButtonTone, type ButtonVariant } from "../button.ts";
import { mediaMatches, narrowerThan, subscribeMedia } from "../media.ts";
import { takePageHue } from "../appearance.ts";
import type { WidthStage } from "../controls.ts";
import { useLabelMode } from "./useLabelMode.ts";
import { useTipBubble } from "./useTipBubble.tsx";
import { glyphFor, IconClose } from "./glyphs.tsx";

export type { ButtonSize, ButtonTone, ButtonVariant } from "../button.ts";

// The one clickable control; what it shows and how wide it is come from
// buttonView() in the core. The other props of a <button> go to the element.

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "disabled" | "onClick" | "title" | "type" | "autoFocus"> {
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
  /** Makes it a link with the button's look. A disabled one stays a disabled button. */
  href?: string;
  /** What stands before the glyph, such as a count. */
  before?: ReactNode;
  /** What stands after the words, such as a key cap. */
  after?: ReactNode;
  type?: "button" | "submit";
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
  /** Its glyph alone in a square in every label mode, where the words have no
   *  room. The label stays the name and the bubble. */
  compact?: boolean;
  /** Turns compact while the window is narrower than this many pixels. */
  compactBelow?: number;
  size?: ButtonSize;
  /** Keeps the label visible in every mode, for a button whose label is
   *  content rather than a verb, such as a directory row in a folder browser.
   *  The glyph still shows beside it. */
  keepLabel?: boolean;
  className?: string;
}

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
  compact = false,
  compactBelow,
  size,
  href,
  before,
  after,
  ref,
  ...rest
}: ButtonProps) {
  const mode = useLabelMode("buttons");
  const query = compactBelow === undefined ? null : narrowerThan(compactBelow);
  const narrow = useSyncExternalStore(
    (fn) => (query ? subscribeMedia(query, fn) : () => {}),
    () => (query ? mediaMatches(query) : false),
    () => false,
  );
  // A chip always closes, so it has a glyph even when no call site passes one.
  const resolved =
    glyph ?? (labelKey ? glyphFor(labelKey) : undefined) ?? (variant === "chip" ? <IconClose /> : undefined);
  const view = buttonView({
    mode,
    label,
    hasGlyph: !!resolved || busy,
    tone,
    variant,
    disabled,
    keepLabel,
    compact: compact || narrow,
    size,
    title,
    hueIndex,
    stage: stageOverride,
  });
  const tooltip = useTipBubble(view.tip, disabled);
  const Element = (href && !disabled ? "a" : "button") as "button";
  const own = href && !disabled ? { href } : { type, disabled, autoFocus };
  const handlers = view.pageHue
    ? {
        ...tooltip.handlers,
        onMouseEnter: (e: MouseEvent<HTMLElement>) => {
          takePageHue(e.currentTarget);
          tooltip.handlers.onMouseEnter();
        },
        onFocus: (e: FocusEvent<HTMLElement>) => {
          takePageHue(e.currentTarget);
          tooltip.handlers.onFocus();
        },
      }
    : tooltip.handlers;

  return (
    <>
      {/* `wrap` boxes only a disabled button with a tip, since a disabled
          <button> emits no mouse events. */}
      {tooltip.wrap(
        <Element
          {...rest}
          {...own}
          ref={mergeRefs(ref, tooltip.ref)}
          onClick={onClick}
          aria-busy={busy || undefined}
          aria-describedby={tooltip.describedBy}
          {...handlers}
          style={view.style}
          className={`${view.className} ${className}`.trim()}
        >
          {before}
          {view.showGlyph && (
            <span className="glim-btn-glyph">
              {busy ? <span className="glim-spinner" /> : resolved}
            </span>
          )}
          <span className={view.labelClass}>{label}</span>
          {after}
        </Element>,
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
