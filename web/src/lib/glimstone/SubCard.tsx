import { useId, type ReactNode } from "react";
import { Badge } from "./Badge.tsx";
import { InfoBubble } from "./InfoBubble.tsx";

/**
 * A flat, filled group inside a card or a window. It groups without a second
 * raised surface and takes the place of a fold-out, so nothing hides behind a
 * click. Fields and quiet buttons inside it step up one surface, so they do
 * not vanish into its fill.
 */
export function SubCard({
  title,
  hint,
  end,
  children,
}: {
  /** The group's name, drawn as a section badge on its top edge. */
  title?: string;
  /** One line on what the group does, drawn as an "(i)" inside the badge. */
  hint?: string;
  /** What belongs to the whole group, such as a switch, at the end of the
   *  heading's row. */
  end?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section data-glim="SubCard" data-glim-title={title} className={`glim-subcard${title ? " glim-subcard--titled" : ""}`} aria-labelledby={title ? titleId : undefined}>
      {/* The id is on the words alone, or the bubble's text would join the
          group's name. */}
      {title && (
        <h3 className="glim-panel-heading">
          <Badge tone="heading" size="heading" wrap>
            <span id={titleId}>{title}</span>
            {hint && <InfoBubble tip={hint} onAccent />}
          </Badge>
        </h3>
      )}
      {end && <div className="glim-subcard-end">{end}</div>}
      {children}
    </section>
  );
}
