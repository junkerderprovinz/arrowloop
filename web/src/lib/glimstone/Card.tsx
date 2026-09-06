import type { CSSProperties, ReactNode } from "react";
import { hueVars, rainbowAt } from "../appearance";
import { Badge } from "./Badge";
import { InfoBubble } from "./InfoBubble";

/**
 * The surface everything else sits on, and the one place a section heading is
 * drawn.
 *
 * A card is not a `div` with a shadow: it carries four decisions that only look
 * cosmetic until one of them is skipped.
 *
 * 1. **The heading is a filled badge, not styled text.** The `<h2>` stays, so a
 *    screen reader still announces a real heading level; what changes is what is
 *    drawn inside it. The badge straddles the card's own top edge, which is why
 *    the box is `relative` — the notch resolves against THIS card, not against
 *    whatever ancestor happens to be positioned.
 * 2. **An explanation goes in a bubble, never as a grey paragraph under the
 *    title.** `hint` renders an "(i)" inside the badge. It rides inside the
 *    badge's own children rather than beside it, because the badge is out of
 *    normal flow: a sibling would drop to the badge's old flow position and end
 *    up alone at the top of the card, next to nothing.
 * 3. **The card owns its rainbow position, so its contents inherit it.** With a
 *    `hueIndex`, the card redefines `--accent` once for everything inside it.
 *    Without that, every button in the card would have to re-derive the same hue
 *    by hand from the same index, which is a convention that holds right up
 *    until one call site forgets — and one forgotten button is exactly what a
 *    rainbow audit finds later.
 * 4. **A nested card drops its surface and its side padding, and keeps its top
 *    padding.** A card drawn inside another card paints the parent's own colour
 *    over the parent: invisible as a card, very visible as unexplained
 *    indentation. The top padding is not decoration, though — the heading notch
 *    pokes half its height down into the box, and removing that space drops the
 *    badge onto the first field.
 *
 * A card with neither `title` nor `hint` draws no heading at all, which is the
 * right call when something one level down already names the same thing.
 */
export function Card({
  title,
  hint,
  children,
  hueIndex,
  nested,
}: {
  /** The section name. Optional: omit it where a control inside already carries
   *  the same name, and the badge still renders (keeping the card's hue notch)
   *  with no redundant text in it. */
  title?: string;
  /** One line saying what this whole card does, drawn as an "(i)" beside the
   *  title rather than as a permanent paragraph. */
  hint?: string;
  children: ReactNode;
  /** This card's position in the rainbow, counted across the cards visible on
   *  the currently active tab. Omit it for a tab's only card. */
  hueIndex?: number;
  /** This card sits inside another card that already provides the surface and
   *  the padding. */
  nested?: boolean;
}) {
  return (
    <div
      className={`relative glim-notch-card flex flex-col gap-4 ${
        nested ? "pt-5" : "bg-carbon-surface rounded-card p-5"
      }${hueIndex !== undefined ? " glim-hue" : ""}`}
      style={hueIndex !== undefined ? (hueVars(rainbowAt(hueIndex)) as CSSProperties) : undefined}
    >
      {(title || hint) && (
        <h2 className="flex items-center">
          <Badge tone="heading" size="heading" wrap hueIndex={hueIndex}>
            {title}
            {hint && <InfoBubble tip={hint} onAccent />}
          </Badge>
        </h2>
      )}
      {children}
    </div>
  );
}
