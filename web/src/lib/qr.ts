import qrcode from "qrcode-generator";

// A QR code as path data without JSX, so the phone draws the same code as
// components/QRCode.tsx. One path rather than a rectangle per module, which is
// around a thousand nodes for a wallet address.

/** The clear margin the QR spec requires around a code, in modules. */
export const QUIET = 4;

export interface QRPath {
  /** SVG path data for the dark modules, in module units. */
  path: string;
  /** The edge length of the square viewBox, in the same units. */
  extent: number;
}

export function buildQR(value: string): QRPath {
  // Version 0 picks the smallest that fits; level M is enough for a screen.
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
