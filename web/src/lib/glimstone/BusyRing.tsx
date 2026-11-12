import type { CSSProperties } from "react";
import { busyRingView, type BusyRingSize } from "../busy.ts";

export type { BusyRingSize } from "../busy.ts";

// The ring that turns while the app works on something: two arcs turning
// against each other. It shows only after BUSY_DELAY, so a quick answer never
// flashes it.

export interface BusyRingProps {
  /** `small` fits a button's glyph slot, `large` a card that waits. */
  size?: BusyRingSize;
  /** What is being waited for. With it the ring is a status that says so, without
   *  it the ring is hidden from assistive technology and its surroundings speak. */
  label?: string;
  /** Milliseconds before it shows; 0 shows it at once. */
  delay?: number;
  className?: string;
}

export function BusyRing({ size, label, delay, className }: BusyRingProps) {
  const view = busyRingView({ size, delay });
  return (
    <span
      data-glim="BusyRing"
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={className ? `${view.className} ${className}` : view.className}
      style={view.style as CSSProperties}
    >
      <span className="glim-busy-ring-arc">
        <span className="glim-busy-ring-tail" />
      </span>
      <span className="glim-busy-ring-arc glim-busy-ring-arc--inner">
        <span className="glim-busy-ring-tail" />
      </span>
      {label && <span className="glim-sr-only">{label}</span>}
    </span>
  );
}
