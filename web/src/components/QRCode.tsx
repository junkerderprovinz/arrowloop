import { useMemo } from "react";

import { buildQR } from "../lib/qr";

// ---------------------------------------------------------------------------
// QRCode — a URI as a scannable square.
//
// The geometry lives in lib/qr.ts, because the phone draws the same square and
// cannot read a file that returns `<svg>`. This is the browser's element around
// it and nothing more.
//
// The colours are fixed black on white and do NOT follow the theme, which is
// deliberate. A phone camera needs contrast in the direction it expects, and a
// code drawn in the interface's own dark surface with a light foreground is
// inverted: some scanners cope, plenty do not, and "my authenticator will not
// read it" is a bad first minute with a security feature. The white square is
// given a little padding of its own because the quiet zone is part of the spec,
// not decoration.
// ---------------------------------------------------------------------------

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
