// The shared status chip. Badge paints a fixed-size, fixed-shape chip in a
// tone; mapping a domain status to a tone stays with the call site.
//
// Each size stage pins height, horizontal padding and font size together, so
// no call site repeats its own literals:
//   small   18px tall, 11px text (--text-caption)
//   medium  20px tall, 12px text (--text-dense), the usual status chip
//   large   24px tall, 12px text, a count badge or a button-weight badge
//   heading 22px, the section heading notch
//   icon    32px, every square icon-only badge
//
// Square icon badges have one size. Sizes chosen per role end up side by side
// in one card, where a user sees only that they differ. 32px is the height of
// the usual text field (`text-sm px-3 py-1.5`), so a badge beside a field
// aligns with it.
//
// `as="button"` and `as="a"` resolve to the same box as a span at the same
// stage: `appearance-none` strips native button chrome, `box-border` keeps
// padding out of the height, and `min-h-0` stops a stretching flex or grid
// parent from growing the box. `as="a"` is a real anchor, so copying the link
// and opening it in a new tab work.
//
// `wrap` makes the stage height a floor with vertical padding, so a second
// line grows the box instead of spilling out of it. The box loses its definite
// height, so a wrap badge beside a taller flex sibling stretches unless it has
// `self-start`.
//
// `tone="heading"` with `size="heading"` is the card heading notch: a solid
// accent fill with the computed contrast ink, straddling the card's top edge.
// It takes none of the four state hues, which would claim a status the heading
// does not have, and its 22px stage keeps it apart from status chips. Only the
// outermost heading of a card or dialog is a badge; nested sub-labels, a page's
// <h1> and a heading on a filled status callout stay plain text.
//
// A numbered heading is two badges, never one split pill. `inFlow` keeps the
// notch's look but drops its positioning, so the caller positions its <h2> with
// `absolute top-0 -translate-y-1/2` and lays the badges out with flexbox.

import type { CSSProperties, ReactNode } from "react";
import { hueVars } from "../appearance";
import { IconTipButton } from "./IconTipButton";

export type BadgeTone = "ok" | "fail" | "warn" | "active" | "neutral" | "heading" | "muted";
export type BadgeSize = "small" | "medium" | "large" | "heading" | "icon";
// pill: fully round, for standalone chips and counts. rounded: the default,
// following the shape engine's --radius-control. square: a square-aspect icon
// tile on the same token. circle: pill radius with the width locked to the
// height. Pill uses the plain length token, because a percentage radius
// resolves per axis into an ellipse.
export type BadgeShape = "pill" | "rounded" | "square" | "circle";

// An explicit start offset for the heading notch. Without it the notch sits at
// its static position, which follows the card's content padding only when its
// <h2> is a normal-flow child of the padded box. Pass the card's padding step
// when the positioned ancestor and the padded box are different elements, or
// when centred content collapses the <h2> to a zero-width box. Tailwind needs
// literal class names, hence the closed table.
export type NotchInset = 4 | 5 | 6;
const INSET_START_CLASSES: Record<NotchInset, string> = {
  4: "start-4",
  5: "start-5",
  6: "start-6",
};

// warn uses the strong wash, which is meant for small chips; the plain one is
// for panels that hold paragraphs. active is the accent-soft wash, not a solid
// fill, because several running rows can show at once; its ink is accent-ink
// because the flat accent measures 1.5:1 on that wash in the light theme.
const TONE_CLASSES: Record<BadgeTone, string> = {
  ok: "bg-statusOkBg text-statusOk",
  fail: "bg-statusFailBg text-statusFail",
  warn: "bg-statusWarnBgStrong text-statusWarn",
  active: "bg-accentSoft text-accentInk",
  neutral: "bg-carbon-surface2 text-carbon-textSub",
  // A solid fill: any translucent accent wash reads as dimmed.
  heading: "bg-accent text-accentContrast",
  // No background at all, for a quiet caption such as a version link.
  muted: "text-carbon-textMuted",
};

const RADIUS_CLASSES: Record<BadgeShape, string> = {
  pill: "rounded-pill",
  square: "rounded-control",
  rounded: "rounded-control",
  circle: "rounded-pill",
};

// Padding is separate so the icon-only shapes can replace it rather than emit
// two conflicting px-* utilities, whose winner would depend on stylesheet
// order. minHeight replaces height in wrap mode for the same reason.
const SIZE_TOKENS: Record<BadgeSize, { height: string; minHeight: string; text: string; padding: string }> = {
  small: { height: "h-[18px]", minHeight: "min-h-[18px]", text: "text-caption", padding: "px-1.5" },
  medium: { height: "h-5", minHeight: "min-h-5", text: "text-dense", padding: "px-2" },
  large: { height: "h-6", minHeight: "min-h-6", text: "text-dense", padding: "px-2.5" },
  heading: { height: "h-[22px]", minHeight: "min-h-[22px]", text: "text-dense uppercase tracking-widest", padding: "px-3" },
  // text and padding are unused, since an icon-only badge has no text.
  icon: { height: "h-8", minHeight: "min-h-8", text: "text-dense", padding: "px-2" },
};

interface BadgeStyleOptions {
  tone?: BadgeTone;
  size?: BadgeSize;
  shape?: BadgeShape;
  wrap?: boolean;
  className?: string;
  /** Zero horizontal padding and a 1:1 aspect ratio, as for `shape="circle"`.
   *  Badge sets it whenever `tip` is set. */
  iconOnly?: boolean;
  inFlow?: boolean;
  insetStart?: NotchInset;
}

/** The class list a Badge resolves to, shared by the span, button and link. */
function badgeClassName({
  tone = "neutral",
  size = "medium",
  shape = "rounded",
  wrap,
  className,
  iconOnly,
  inFlow,
  insetStart,
}: BadgeStyleOptions = {}): string {
  const { height, minHeight, text, padding } = SIZE_TOKENS[size];
  const isIconOnly = shape === "circle" || iconOnly === true;
  const sizing = wrap
    ? `${minHeight} py-0.5 leading-tight wrap-break-word`
    : `${height} min-h-0 leading-none`;

  // The notch centres on the card's top edge at any height: `translate-y`
  // percentages resolve against the badge's own height, where a fixed -11px
  // would bury the card's first line once a heading wraps. With no start offset
  // it sits at its static position, which is direction-aware. z-10 only has to
  // clear its own card's content. The radius stays a pill in every shape
  // setting, since a notch is window chrome rather than a control, and it takes
  // the elevation shadow without the hairline, which belongs to a surface's own
  // edge.
  const isHeadingNotch = tone === "heading" && size === "heading";
  // The lift stays with an `inFlow` notch; only the positioning goes.
  const notchChrome = isHeadingNotch ? "shadow-[var(--elevation)]" : "";
  const notchPositioning =
    isHeadingNotch && !inFlow
      ? [
          "absolute top-0 -translate-y-1/2 z-10",
          insetStart !== undefined ? INSET_START_CLASSES[insetStart] : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "";

  // An icon-only active badge takes the solid accent with contrast ink: with no
  // text left, the translucent wash only makes the tile look dimmed, and a
  // neutral ink fails contrast on several rainbow hues.
  const toneClasses =
    isIconOnly && tone === "active" ? "bg-accent text-accentContrast" : TONE_CLASSES[tone];

  return [
    "inline-flex box-border items-center justify-center gap-1 font-medium",
    sizing,
    text,
    isIconOnly ? "px-0 aspect-square" : padding,
    isHeadingNotch ? "rounded-pill" : RADIUS_CLASSES[shape],
    toneClasses,
    notchChrome,
    notchPositioning,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface BadgeProps {
  children: ReactNode;
  /** Status colour. Defaults to the neutral chip. */
  tone?: BadgeTone;
  /** Size stage; see the file header. A square icon-only badge is always
   *  `"icon"`. */
  size?: BadgeSize;
  shape?: BadgeShape;
  /** Render as a <button> or a real <a href>, with the same box as a span. */
  as?: "span" | "button" | "a";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  /** Accessible name for an icon-only badge whose glyph is aria-hidden. */
  ariaLabel?: string;
  /** `as="a"` only: passed straight through to the underlying <a>. */
  href?: string;
  target?: string;
  rel?: string;
  /** Let content that wraps grow the box instead of overflowing it. */
  wrap?: boolean;
  /** Extra classes, such as `tabular-nums` for a count, or `max-w-full` with
   *  `wrap` in a narrow column. */
  className?: string;
  /** Rainbow position, by the caller's list index among the badges visible at
   *  once. Only `heading` and `active` take it, since the other tones are
   *  status signals. Omit it for the only such badge on a page, which keeps
   *  the single accent. */
  hueIndex?: number;
  /** `as="button"` only. The tooltip and accessible name of an icon-only
   *  button, rendered through IconTipButton; it also makes the badge
   *  icon-only for sizing, and replaces `title` and `ariaLabel`. */
  tip?: string;
  /** Heading notch only: the Tailwind spacing step of the card's content
   *  padding (`insetStart={5}` for `p-5`), for the two cases NotchInset
   *  describes. Omit it where the static position already lands right. */
  insetStart?: NotchInset;
  /** Heading notch only: keep the notch's look without positioning it, for
   *  several heading badges that straddle one card edge together inside a
   *  caller-positioned <h2>. `insetStart` is ignored alongside it. A heading
   *  badge in normal flow is a `tone="heading"` badge at another size. */
  inFlow?: boolean;
}

export function Badge({
  children,
  tone = "neutral",
  size = "medium",
  shape = "rounded",
  as = "span",
  onClick,
  disabled,
  title,
  ariaLabel,
  href,
  target,
  rel,
  wrap,
  className,
  hueIndex,
  tip,
  insetStart,
  inFlow,
}: BadgeProps) {
  // No rainbow subscription: Badge holds no hooks so a test can call it as a
  // plain function, and hueVars points at the root's colours, so a palette
  // change reaches the badge without a render.
  //
  // In the light theme --accent-ink is a fixed value, so a hued active badge's
  // text keeps the gold-calibrated ink while its background follows the hue.
  const hueOn = hueIndex !== undefined && (tone === "heading" || tone === "active");
  // `.glim-notch-hue` drives the card-wide reactive hover in tokens.css, so it
  // is only set on a heading-sized badge.
  const isNotchHue = hueOn && size === "heading";
  const shared = badgeClassName({ tone, size, shape, wrap, className, iconOnly: tip !== undefined, inFlow, insetStart });
  const merged = hueOn ? `glim-hue ${isNotchHue ? "glim-notch-hue " : ""}${shared}` : shared;
  const hueStyle = hueOn ? (hueVars(hueIndex) as CSSProperties) : undefined;

  if (as === "button") {
    const buttonClassName = `appearance-none transition-opacity hover:opacity-80 disabled:opacity-50 disabled:hover:opacity-50 ${merged}`;
    if (tip !== undefined) {
      return (
        <IconTipButton tip={tip} onClick={onClick} disabled={disabled} style={hueStyle} className={buttonClassName}>
          {children}
        </IconTipButton>
      );
    }
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        style={hueStyle}
        className={buttonClassName}
      >
        {children}
      </button>
    );
  }

  if (as === "a") {
    return (
      <a href={href} target={target} rel={rel} title={title} aria-label={ariaLabel} style={hueStyle} className={`transition-opacity hover:opacity-80 ${merged}`}>
        {children}
      </a>
    );
  }

  return (
    <span title={title} aria-label={ariaLabel} style={hueStyle} className={merged}>
      {children}
    </span>
  );
}
