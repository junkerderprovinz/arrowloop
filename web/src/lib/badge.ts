// The shared status chip. A badge is a fixed-size, fixed-shape chip in a tone;
// mapping a domain status to a tone stays with the call site.
//
// Each size stage pins height, horizontal padding and font size together, so
// no call site repeats its own literals:
//   small   18px tall, 12px text (--text-meta)
//   medium  20px tall, 12px text, the usual status chip
//   large   24px tall, 12px text, a count badge or a button-weight badge
//   heading 22px, the section heading notch
//   icon    32px, every square icon-only badge
//
// Square icon badges have one size. Sizes chosen per role end up side by side
// in one card, where a user sees only that they differ. 32px is the height of
// the usual text field, so a badge beside a field aligns with it.
//
// `tone: "heading"` with `size: "heading"` is the card heading notch: a solid
// accent fill with the computed contrast ink, straddling the card's top edge.
// It takes none of the four state hues, which would claim a status the heading
// does not have, and its 22px stage keeps it apart from status chips. The
// heading of a card, a sub-card or a window is a badge. A page's <h1> and a
// heading on a filled status callout stay plain text.

export type BadgeTone = "ok" | "fail" | "warn" | "active" | "neutral" | "heading" | "muted";
export type BadgeSize = "small" | "medium" | "large" | "heading" | "icon";
// The four forms of a badge. Without a form the corners follow the shape
// setting through --radius-pill. With one they keep it under every setting:
// rounded a small radius, square none, pill half the badge's height, so a
// short badge never turns into a lozenge, and circle a circle around one glyph.
export type BadgeForm = "rounded" | "square" | "pill" | "circle";

/** @deprecated Use `BadgeForm`. Only "circle" has an effect: it makes the badge icon-only. */
export type BadgeShape = "pill" | "rounded" | "square" | "circle";

// An explicit start offset for the heading notch, as a quarter-rem step.
// Without it the notch sits at its static position, which follows the card's
// content padding only when its <h2> is a normal-flow child of the padded box.
// Pass the card's padding step when the positioned ancestor and the padded box
// are different elements, or when centred content collapses the <h2> to a
// zero-width box.
export type NotchInset = 4 | 5 | 6;

export interface BadgeOptions {
  tone?: BadgeTone;
  size?: BadgeSize;
  form?: BadgeForm;
  /** @deprecated Use `form`. */
  shape?: BadgeShape;
  /** The stage height becomes a floor with vertical padding, so a second line
   *  grows the box instead of spilling out of it. The box then has no definite
   *  height, so beside a taller flex sibling it stretches unless aligned. */
  wrap?: boolean;
  /** Zero horizontal padding and a 1:1 aspect ratio, as for `form: "circle"`. */
  iconOnly?: boolean;
  /** Heading notch only: keep its look without positioning it, for several
   *  heading badges that straddle one card edge together inside a
   *  caller-positioned <h2>. */
  inFlow?: boolean;
  insetStart?: NotchInset;
  /** A <button> or <a>: it hovers by a colour step, like Button (rule 21). */
  action?: boolean;
}

/** The class list of a badge, the same for a span, a button and a link. */
export function badgeClassName({
  tone = "neutral",
  size = "medium",
  form,
  shape,
  wrap,
  iconOnly,
  inFlow,
  insetStart,
  action,
}: BadgeOptions = {}): string {
  const isIconOnly = form === "circle" || shape === "circle" || iconOnly === true;
  const isNotch = tone === "heading" && size === "heading";
  // An icon-only active badge takes the solid accent with contrast ink: with no
  // text left, the translucent wash only makes the tile look dimmed, and a
  // neutral ink fails contrast on several rainbow hues.
  const fill = tone === "heading" || (isIconOnly && tone === "active") ? "solid" : tone;
  return [
    "glim-badge",
    `glim-badge--${size}`,
    `glim-badge--${fill}`,
    form && `glim-badge--${form}`,
    wrap && "glim-badge--wrap",
    isIconOnly && "glim-badge--icon-only",
    isNotch && "glim-badge--notch",
    isNotch && !inFlow && "glim-badge--notch-placed",
    isNotch && !inFlow && insetStart !== undefined && `glim-badge--inset-${insetStart}`,
    action && "glim-badge-action",
    // The neutral and muted badges take rule 40's accent tint like a Button.
    action && tone === "neutral" && "glim-btn-subtle",
    action && tone === "muted" && "glim-btn-bare",
  ]
    .filter(Boolean)
    .join(" ");
}
