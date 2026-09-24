import type { CSSProperties, ReactNode } from "react";
import { hueVars } from "../appearance";
import { Badge } from "./Badge";
import { InfoBubble } from "./InfoBubble";

/**
 * The surface everything else sits on, and the one place a section heading is
 * drawn.
 *
 * The `<h2>` holds a filled badge that straddles the card's top edge, so the box
 * is `relative` for the notch to resolve against this card. The `hint` bubble
 * rides inside the badge because the badge is out of normal flow. With a
 * `hueIndex` the card sets `--accent` once for everything inside it, so no button
 * has to derive the hue itself. A nested card drops its surface and side padding
 * but keeps its top padding, which the heading notch pokes into.
 *
 * A card with neither `title` nor `hint` draws no heading.
 */
export function Card({
  title,
  hint,
  children,
  hueIndex,
  nested,
}: {
  /** The section name. Omit it where a control inside already carries the same
   *  name; the badge still renders to keep the card's hue notch. */
  title?: string;
  /** One line saying what this whole card does, drawn as an "(i)" beside the
   *  title. */
  hint?: string;
  children: ReactNode;
  /** This card's position in the rainbow, counted across the cards visible on
   *  the active tab. Omit it for a tab's only card. */
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
      style={hueIndex !== undefined ? (hueVars(hueIndex) as CSSProperties) : undefined}
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
