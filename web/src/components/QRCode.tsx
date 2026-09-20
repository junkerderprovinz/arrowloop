import { useMemo } from "react";

import { buildQR } from "../lib/qr";

/**
 * A URI as a scannable square, drawn from the geometry in lib/qr.ts, which the
 * phone shares. Always black on white, since many scanners fail on an inverted
 * code.
 */
export function QRCode({
  value,
  size = 200,
  className,
}: {
  value: string;
  /** Rendered edge length in pixels. The SVG scales, so this is presentation only. */
  size?: number;
  className?: string;
}) {
  const { path, extent } = useMemo(() => buildQR(value), [value]);
  return (
    <svg
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
