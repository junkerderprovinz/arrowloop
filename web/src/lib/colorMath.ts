// ---------------------------------------------------------------------------
// Hex and HSV, and nothing that needs a document.
//
// Split out of lib/colorPicker.ts so the phone can mix the same colours: that
// file builds DOM elements from its first line, and Metro has no document to
// build them in. The arithmetic is not DOM, though - it is three pure
// functions - so it travels and the elements do not.
//
// The same move glyphs.data.ts, schedule.data.ts and qr.ts already made, and
// here the reason has a sharp edge: a colour mixed on a phone and the same
// colour mixed in a browser have to be the same six digits. Two
// implementations agree until the day one of them rounds differently, and then
// an accent set on the phone comes back a shade off in the container, with
// nothing anywhere to say which one moved.
// ---------------------------------------------------------------------------

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const group = m?.[1];
  if (!group) return null;
  const n = parseInt(group, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx ? d / mx : 0, v: mx };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const f = (u: number) =>
    Math.round((u + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/** Accepts "2f6feb" or "#2F6FEB", answers "#rrggbb" lowercase, or null. */
export function normalizeHex(value: string): string | null {
  const trimmed = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(trimmed) ? `#${trimmed.toLowerCase()}` : null;
}

/**
 * Which preset a live colour belongs to: plain squared distance in RGB.
 *
 * It only has to be stable and unsurprising across widely separated hues,
 * which is what a preset row is, so a perceptual colour space would be
 * precision nobody can see spent on a question nobody asks.
 *
 * Answers -1 for an empty list rather than 0, so a caller cannot index into
 * nothing.
 */
export function nearestPreset(presets: string[], value: string): number {
  const target = hexToHsv(value);
  if (!presets.length || !target) return -1;
  const rgb = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const want = rgb(value);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  presets.forEach((hex, i) => {
    const c = rgb(hex);
    const d = (c.r - want.r) ** 2 + (c.g - want.g) ** 2 + (c.b - want.b) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}
