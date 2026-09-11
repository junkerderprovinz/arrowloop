import qrcode from "qrcode-generator";

// ---------------------------------------------------------------------------
// A QR code as one path.
//
// Split out of components/QRCode.tsx so the phone can draw the same square: the
// component returns `<svg>`, which Metro cannot parse and React Native has no
// element for, but the geometry is only path data. The same move glyphs.data.ts
// and schedule.data.ts made, for the same reason - a second implementation of
// this would agree with the browser until the day one of them was touched, and
// on a payment address a code that scans to something else is not a cosmetic
// difference.
//
// Drawn as ONE path rather than a grid of rectangles. A wallet address lands on
// a 33x33 module code, which is around a thousand dark modules; as elements
// that is a thousand nodes for a picture, and as a path it is one.
// ---------------------------------------------------------------------------

/** The mandatory clear margin around a code, in modules. Part of the spec, not
 *  decoration: a scanner needs it to find the code's edge. */
export const QUIET = 4;

export interface QRPath {
  /** SVG path data for the dark modules, in module units. */
  path: string;
  /** The edge length of the drawing, in the same units - the viewBox is square. */
  extent: number;
}

export function buildQR(value: string): QRPath {
  // Type 0 means "pick the smallest version that fits"; level M is the usual
  // trade for a screen, where the code is not going to be smudged or folded.
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();

  const parts: string[] = [];
  for (let row = 0; row < count; row++) {
    // Runs of adjacent dark modules become one rectangle instead of one each.
    let runStart = -1;
    for (let col = 0; col <= count; col++) {
      const dark = col < count && qr.isDark(row, col);
      if (dark && runStart < 0) {
        runStart = col;
      } else if (!dark && runStart >= 0) {
        parts.push(`M${runStart + QUIET} ${row + QUIET}h${col - runStart}v1h-${col - runStart}z`);
        runStart = -1;
      }
    }
  }
  return { path: parts.join(""), extent: count + QUIET * 2 };
}
