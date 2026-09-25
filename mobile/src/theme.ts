// GlimStone's design tokens for React Native. The values are copied from
// web/src/tokens.css, which are CSS custom properties; the accent presets and
// the rainbow are plain data and imported directly.

import { DEFAULT_SHAPE, type Shape } from "../../web/src/lib/appearance";

export { ACCENTS, DEFAULT_ACCENT, RAINBOW, contrastOn, rainbowAt } from "../../web/src/lib/appearance";

export type Scheme = "dark" | "light";

export interface Palette {
  background: string;
  surface: string;
  surface2: string;
  surface3: string;
  hover: string;
  border: string;
  text: string;
  textSub: string;
  textMuted: string;
  /** Each status has an ink for text on the page and a solid for fills; on
   *  the light theme the ink is darker. */
  okInk: string;
  okSolid: string;
  failInk: string;
  failSolid: string;
  warnInk: string;
  warnSolid: string;
  neutralInk: string;
  neutralSolid: string;
}

const dark: Palette = {
  background: "#161616",
  surface: "#262626",
  surface2: "#393939",
  surface3: "#525252",
  hover: "#353535",
  border: "#393939",
  text: "#f4f4f4",
  textSub: "#c6c6c6",
  textMuted: "#8d8d8d",
  okInk: "#6fdc8c",
  okSolid: "#6fdc8c",
  failInk: "#ff8389",
  failSolid: "#ff8389",
  warnInk: "#f1c21b",
  warnSolid: "#f1c21b",
  neutralInk: "#a8a8a8",
  neutralSolid: "#8d8d8d",
};

const light: Palette = {
  // Off-white, since surfaces are separated by shade and white cards would
  // vanish on a white page.
  background: "#f4f4f4",
  surface: "#ffffff",
  surface2: "#e8e8e8",
  surface3: "#d1d1d1",
  hover: "#e0e0e0",
  border: "#d1d1d1",
  text: "#161616",
  textSub: "#525252",
  textMuted: "#6f6f6f",
  okInk: "#0e6027",
  okSolid: "#198038",
  failInk: "#da1e28",
  failSolid: "#da1e28",
  warnInk: "#8E6A00",
  warnSolid: "#b28600",
  neutralInk: "#6f6f6f",
  neutralSolid: "#8d8d8d",
};

export const palettes: Record<Scheme, Palette> = { dark, light };

/**
 * The About card's brand marks per theme, adjusted from the published brand
 * colours to reach the 3:1 a graphic needs: the published Buy Me a Coffee
 * yellow reads 1.14:1 on the light surface, PayPal's navy fails on the dark
 * one. Bitcoin keeps its own disc, which carries its own ground, and the mail
 * button takes the accent.
 */
export const BRAND: Record<Scheme, Record<"coffee" | "paypal" | "github", string>> = {
  dark: { coffee: "#ffdd00", paypal: "#4fb5f0", github: "#ffffff" },
  light: { coffee: "#8a6d00", paypal: "#003087", github: "#181717" },
};

/**
 * Darkens the accent for use as text on the light theme. The 55% is
 * tokens.css's `--ink-mix`, applied as `color-mix(in srgb, accent 55%, black)`,
 * so both apps produce the same colour.
 */
export function inkFor(hex: string, scheme: Scheme): string {
  if (scheme === "dark") return hex;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const mix = (c: number) => Math.round(c * 0.55);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`;
}

/** A translucent wash of a colour, as rgba since React Native has no color-mix. */
export function softOn(hex: string, alpha = 0.14): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "transparent";
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The type scale. The roles match the web, but the sizes are the ones the
 * other GlimStone phone app uses rather than the web's rem values.
 */
export const text = {
  heading: 20,
  title: 16,
  body: 14,
  dense: 12,
  caption: 11,
} as const;

/** Spacing in the web's 4px steps. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export interface Radii {
  card: number;
  control: number;
  pill: number;
}

/**
 * Corner radii per shape setting, from tokens.css at a 16px root. `soft`
 * flattens pills as well, or switches and badges would ignore the setting.
 * `leaf` rounds only two opposite corners, which cornersFor takes care of.
 */
export const RADII: Record<Shape, Radii> = {
  round: { card: 20, control: 12, pill: 9999 },
  soft: { card: 8, control: 5, pill: 5 },
  square: { card: 0, control: 0, pill: 0 },
  leaf: { card: 20, control: 12, pill: 18 },
};

export function radiusFor(shape: string): Radii {
  return RADII[shape as Shape] ?? RADII[DEFAULT_SHAPE];
}

export interface Corners {
  borderRadius: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
}

/**
 * The corner style for each radius, to spread into a style. The leaf's sharp
 * corners are physical rather than start and end, so it leans the same way in
 * a right-to-left language.
 */
export function cornersFor(shape: string): Record<keyof Radii, Corners> {
  const r = radiusFor(shape);
  const round = (borderRadius: number): Corners =>
    shape === "leaf" ? { borderRadius, borderTopRightRadius: 0, borderBottomLeftRadius: 0 } : { borderRadius };
  return { card: round(r.card), control: round(r.control), pill: round(r.pill) };
}

/** Android's minimum touch target. */
export const TOUCH = 48;

/** The dimming behind a floating window, matching GlimStone's `--glim-scrim`. */
export const SCRIM = "rgba(0, 0, 0, 0.65)";
