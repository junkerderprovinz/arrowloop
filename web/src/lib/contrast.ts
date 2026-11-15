// The contrast arithmetic of WCAG 2, and the inks the colour engine computes
// with it. Every ink it hands out reaches 4.5:1, the minimum for body text,
// whatever colour somebody picked or the system supplied.

import { darkenTo, INK_LIGHTNESS, lightenTo } from './oklab.ts';

/** The ratio body text needs, and the floor of every ink computed here. */
export const MIN_TEXT_CONTRAST = 4.5;

// Carbon's own ink: on a yellow accent a brown-tinted black reads as a smudge.
const DARK_INK = '#161616';
const WHITE = '#FFFFFF';
const BLACK = '#000000';

// The card surface of each ramp in tokens.css, where accent text mostly sits.
// The presets were measured against these, and OLED's darker card only adds
// to the dark figure, so the dark ink holds there as well.
const LIGHT_CARD = '#FFFFFF';
const DARK_CARD = '#262626';
// The share of the accent in --accent-soft, which applyAccent writes.
const SOFT_SHARE = 0.14;


type Rgb = [number, number, number];

export function validHex(hex: string | undefined): hex is string {
  return !!hex && /^#[0-9a-fA-F]{6}$/.test(hex);
}

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexOf(c: Rgb): string {
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** `amount` of `to` in `from`, the way color-mix() in srgb mixes. */
function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * amount) as Rgb;
}

/**
 * Relative luminance. The channels are linearised first because raw sRGB
 * overstates blue and understates green.
 */
function luminance(c: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

function ratio(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The WCAG contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  return ratio(rgb(a), rgb(b));
}

/**
 * `from` moved toward `to` just far enough to reach the minimum against
 * `ground`, as a hex colour. The ratio only grows on the way, as long as `to`
 * lies on the far side of `from` from the ground, so halving finds the least
 * amount that does it.
 */
function pushed(from: Rgb, to: Rgb, ground: Rgb): string {
  const reaches = (t: number) => ratio(mix(from, to, t).map(Math.round) as Rgb, ground) >= MIN_TEXT_CONTRAST;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid)) hi = mid;
    else lo = mid;
  }
  return hexOf(mix(from, to, hi));
}

/**
 * The ink for text or a glyph on a fill of the given colour: white or Carbon's
 * near-black, whichever reads better. On the mid-tones where neither reaches
 * 4.5:1, the near-black goes on toward black until it does, which it always
 * can.
 */
export function contrastOn(hex: string): string {
  if (!validHex(hex)) return WHITE;
  const fill = rgb(hex);
  const onWhite = ratio(fill, rgb(WHITE));
  const onDark = ratio(fill, rgb(DARK_INK));
  if (onWhite > onDark && onWhite >= MIN_TEXT_CONTRAST) return WHITE;
  if (onDark >= MIN_TEXT_CONTRAST) return DARK_INK;
  return pushed(rgb(DARK_INK), rgb(BLACK), fill);
}

/**
 * The accent used as ink on each ramp, where the theme's own derivation in
 * tokens.css falls short of 4.5:1 on its card or on the accent's own wash
 * there (--accent-soft, a picked row or a selected badge). Undefined for a
 * ramp means the stylesheet's step holds and nothing needs setting, which is
 * the case for every preset.
 *
 * Each starts from the stylesheet's own step in OKLab (oklab.ts) and, should
 * that fall short, goes on in sRGB: the light ink toward black, the dark ink
 * toward white.
 */
export function accentInks(hex: string): { light: string | undefined; dark: string | undefined } {
  if (!validHex(hex)) return { light: undefined, dark: undefined };
  const accent = rgb(hex);
  const light = rgb(darkenTo(hex, INK_LIGHTNESS.light));
  const dark = rgb(lightenTo(hex, INK_LIGHTNESS.dark));
  // The wash darkens white and lightens the dark card, so it is the tighter
  // ground on either ramp.
  const lightWash = mix(rgb(LIGHT_CARD), accent, SOFT_SHARE).map(Math.round) as Rgb;
  const darkWash = mix(rgb(DARK_CARD), accent, SOFT_SHARE).map(Math.round) as Rgb;
  const reads = (ink: Rgb, card: Rgb, wash: Rgb) => Math.min(ratio(ink, card), ratio(ink, wash)) >= MIN_TEXT_CONTRAST;
  return {
    light: reads(light, rgb(LIGHT_CARD), lightWash) ? undefined : pushed(light, rgb(BLACK), lightWash),
    dark: reads(dark, rgb(DARK_CARD), darkWash) ? undefined : pushed(dark, rgb(WHITE), darkWash),
  };
}

// --carbon-text of each ramp in tokens.css, which a filled control's hover
// moves toward.
const LIGHT_TEXT = '#161616';
const DARK_TEXT = '#F4F4F4';
// The hover's step, color-mix(accent 85%, text) in tokens.css.
const HOVER_STEP = 0.15;

/**
 * The hover of an accent fill on each ramp, where the stylesheet's step toward
 * the text colour would take the fill's ink under 4.5:1. That happens on the
 * mid-tones, where the ink only just clears the fill: a grey such as #777777
 * carries a black ink, and on the light ramp its hover darkens toward that
 * black. The hover then takes the same step away from the ink instead, which
 * only adds contrast. Undefined means the stylesheet's step holds, as it does
 * for every preset.
 */
export function accentHovers(hex: string): { light: string | undefined; dark: string | undefined } {
  if (!validHex(hex)) return { light: undefined, dark: undefined };
  const fill = rgb(hex);
  const ink = rgb(contrastOn(hex));
  const away = luminance(ink) > luminance(fill) ? rgb(BLACK) : rgb(WHITE);
  const hover = (text: string) => {
    const toward = mix(fill, rgb(text), HOVER_STEP).map(Math.round) as Rgb;
    return ratio(ink, toward) >= MIN_TEXT_CONTRAST ? undefined : hexOf(mix(fill, away, HOVER_STEP));
  };
  return { light: hover(LIGHT_TEXT), dark: hover(DARK_TEXT) };
}
