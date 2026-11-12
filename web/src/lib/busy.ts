// What a BusyRing and a SkeletonRow draw while the app waits. Both stay out of
// sight for BUSY_DELAY, so an answer that comes quickly never flashes a loader.
// The delay is a CSS custom property read by a reveal in tokens.css, so the
// wait costs no timer.

/** How long a loader waits before it shows, in milliseconds. */
export const BUSY_DELAY = 400;

export type BusyRingSize = "small" | "medium" | "large";

export interface BusyView {
  className: string;
  style: Record<string, string>;
}

function waitStyle(delay: number | undefined): Record<string, string> {
  return { "--busy-delay": `${delay ?? BUSY_DELAY}ms` };
}

export function busyRingView({ size = "medium", delay }: { size?: BusyRingSize; delay?: number }): BusyView {
  return {
    className: size === "medium" ? "glim-busy-ring" : `glim-busy-ring glim-busy-ring--${size}`,
    style: waitStyle(delay),
  };
}

export interface SkeletonRowView extends BusyView {
  tile: boolean;
  badge: boolean;
}

export function skeletonRowView({ delay, tile = true, badge = true }: { delay?: number; tile?: boolean; badge?: boolean }): SkeletonRowView {
  return { className: "glim-skeleton-row", style: waitStyle(delay), tile, badge };
}
