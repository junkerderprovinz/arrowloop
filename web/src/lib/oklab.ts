// OKLab, the colour space the accent ramps are built in. Its lightness follows
// what the eye sees, so one lightness step gives every hue nearly the same
// contrast, which an sRGB mix toward black does not: there blue lands far
// darker than yellow.
//
// Moving a colour toward black along a straight line in OKLab scales linear
// RGB by a cube, so a darkened colour never leaves sRGB. Toward white it can
// by a hair; the browser then clips each channel, and srgbOf does the same.

export type Oklab = [number, number, number];

/**
 * The lightness steps of the accent ramps, mirrored in tokens.css as
 * --ink-l-light and --ink-l-dark: the light ramp's ink sits at this lightness
 * or below, the dark ramp's at this one or above. The contrast step
 * (prefers-contrast: more) takes the second pair.
 */
export const INK_LIGHTNESS = { light: 0.52, dark: 0.74, lightMore: 0.4, darkMore: 0.84 } as const;

const linear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** A `#rrggbb` colour in OKLab. */
export function oklabOf(hex: string): Oklab {
  const n = parseInt(hex.slice(1), 16);
  const r = linear((n >> 16) & 255);
  const g = linear((n >> 8) & 255);
  const b = linear(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** An OKLab colour as `#RRGGBB`, each channel clipped into sRGB. */
export function srgbOf([L, a, b]: Oklab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, gamma(v))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** `hex` moved toward black until its lightness is at most `lightness`. */
export function darkenTo(hex: string, lightness: number): string {
  const [l, a, b] = oklabOf(hex);
  if (l <= lightness) return hex.toUpperCase();
  const k = lightness / l;
  return srgbOf([lightness, a * k, b * k]);
}

/** `hex` moved toward white until its lightness is at least `lightness`. */
export function lightenTo(hex: string, lightness: number): string {
  const [l, a, b] = oklabOf(hex);
  if (l >= lightness) return hex.toUpperCase();
  const k = (1 - lightness) / (1 - l);
  return srgbOf([lightness, a * k, b * k]);
}

/**
 * The CSS that moves `colour` onto a ramp's step the way darkenTo and
 * lightenTo do, for inks the stylesheet derives from a colour it only knows at
 * run time, such as a rainbow position.
 */
export function inkCss(colour: string): string {
  const down = 'var(--ink-l-light)';
  const up = 'var(--ink-l-dark)';
  const light = `oklab(from ${colour} min(l, ${down}) calc(a * min(1, ${down} / l)) calc(b * min(1, ${down} / l)))`;
  const dark = `oklab(from ${colour} max(l, ${up}) calc(a * min(1, (1 - ${up}) / (1 - l))) calc(b * min(1, (1 - ${up}) / (1 - l))))`;
  return `light-dark(${light}, ${dark})`;
}
