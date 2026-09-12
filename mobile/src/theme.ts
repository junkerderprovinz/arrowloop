/**
 * GlimStone, as numbers React Native can use.
 *
 * NOT a second palette. Every value here is copied from web/src/tokens.css,
 * and that is the whole point of the file: the app has to read as ArrowLoop
 * rather than as a second product that happens to share a name. A colour
 * invented here would drift from the container's the first time either
 * changed, and nothing would say so.
 *
 * Why copied rather than imported: the web tokens are CSS custom properties
 * resolved by a browser, and there is no browser here. The ACCENT PRESETS and
 * the rainbow ARE imported, because those are data rather than CSS - see
 * ACCENTS and RAINBOW below.
 *
 * The first cut of this file was copied by EYE rather than by value, and the
 * difference showed up as three separate complaints at once: the radii were
 * 12/8 where the language says 16/10, a pill stayed fully round in `soft`
 * where the language flattens it to 5 - so the corner setting looked like it
 * did nothing - and the light ground was white where the language uses
 * #f4f4f4, which left a white card invisible on a white page.
 */

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
  /** Status colours come in two: the INK version, readable as text on the
   *  page's ground, and the SOLID version, meant to be filled with. On a dark
   *  page they are the same colour; on a light one the ink is darker. */
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
  // #f4f4f4 and NOT white. A white ground makes the white surface above it
  // vanish, and GlimStone separates surfaces by shade rather than by a drawn
  // line - so on a white page every card loses its edge and the whole screen
  // reads as one flat sheet.
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
 * The About card's brand marks, at rest, per theme - and NOT the published
 * brand colours.
 *
 * That reads like a compromise and is the opposite: it is what makes the marks
 * visible at all. A brand colour is designed against white or against its own
 * fill, so on a neutral button ground each one dies on one side of the theme
 * switch. GlimStone measured it on this family's own grounds: Bitcoin's
 * `#F7931A` reads 1.5:1 and Buy Me a Coffee's `#FFDD00` reads 1.14:1 on the
 * light theme's surface, while PayPal's navy and GitHub's near-black fail the
 * same way on the dark one - against the 3:1 a graphic needs. So the warm
 * brands are deepened for the light theme and the dark ones lightened for the
 * dark theme, which is exactly the job `inkFor` already does for the accent.
 *
 * The web spends the TRUE colour on hover, as the button's fill. A phone has no
 * hover and therefore no second state to spend it in, so here the adjusted
 * value is the only one - the rule's purpose survives, its second half has no
 * gesture behind it.
 *
 * Bitcoin is absent on purpose. The crypto button wears the coin's own DISC,
 * which brings its own ground and is therefore readable on either theme
 * unchanged - the same reason the eight tiles in the crypto window keep their
 * colours. Flattening it to one ink would be redrawing the logo.
 *
 * The mail button is absent too, and that is the rule rather than a gap: it
 * reaches this app's own authors rather than a third party, so it takes the
 * accent and follows the user's accent and rainbow - which a vendor's mark may
 * never do.
 */
export const BRAND: Record<Scheme, Record<"coffee" | "paypal" | "github", string>> = {
  dark: { coffee: "#ffdd00", paypal: "#4fb5f0", github: "#ffffff" },
  light: { coffee: "#8a6d00", paypal: "#003087", github: "#181717" },
};

/**
 * The accent, darkened until it can be READ on a light ground.
 *
 * The accent stays the accent wherever something is FILLED with it: the ink on
 * top is computed, so a yellow button is fine. What needs darkening is the
 * accent used AS ink, because yellow text on white is unreadable whichever
 * yellow it is.
 *
 * 55% is not a number picked here: it is tokens.css's own `--ink-mix` in the
 * light theme, through `color-mix(in srgb, var(--accent) var(--ink-mix),
 * black)`. Reimplementing it as "darken until it clears 4.5:1" sounds better
 * and is worse - it agrees on Sunflower and diverges on every other preset, so
 * one setting would produce two different blues on one product.
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

/** A colour as a wash: what a row carries when it owns one. The web lays this
 *  down with color-mix; React Native has none, so it is rgba. */
export function softOn(hex: string, alpha = 0.14): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "transparent";
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The type scale, and it is NOT the web's rem values.
 *
 * GlimStone's sizes are in rem against a 16px root; a phone reads at arm's
 * length rather than at desk distance. So the ROLES are the same - a heading,
 * body, dense, caption - and the numbers are the ones the family's other
 * phone app already uses, so two apps on one handset agree.
 */
export const text = {
  heading: 20,
  title: 16,
  body: 14,
  dense: 12,
  caption: 11,
} as const;

/** Spacing, in the same 4px steps the web uses, so rhythms match. */
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
 * Corner radii per SHAPE, which is a GlimStone setting rather than a constant.
 *
 * The rem values from tokens.css at the usual 16px root, and all three numbers
 * matter. `soft` flattens the PILL to 5 as well: a pill that stayed a capsule
 * while every other corner squared off is the one control that ignores the
 * setting, and with the switches and badges all being pills, that reads as
 * "the corner setting does nothing".
 */
export const RADII: Record<string, Radii> = {
  round: { card: 16, control: 10, pill: 9999 },
  soft: { card: 8, control: 5, pill: 5 },
  square: { card: 0, control: 0, pill: 0 },
};

export function radiusFor(shape: string): Radii {
  return RADII[shape] ?? RADII.round!;
}

/**
 * The smallest thing a finger may be asked to hit.
 *
 * 48 is Android's own figure and it is a floor rather than a target. This is
 * the one number in this file with no counterpart on the web, and it is the
 * reason the screens here are not the desktop ones rearranged: a row that is
 * comfortable with a mouse is a coin toss with a thumb.
 */
export const TOUCH = 48;

/**
 * The ground behind a floating window.
 *
 * ONE value, because it was four: three modals at 0.6 and one at 0.5, each
 * typed where it was needed, so the one at 0.5 had been quietly different for
 * as long as it existed and nothing could notice. That is the same shape the
 * brand colours were in before GlimStone grew tokens for those - a value the
 * rule describes and nothing holds.
 *
 * 0.65 rather than 0.6 (jdp, 12.09.2026: "ich würde die abdunkelung hinter
 * einem schwebefenster nochmal 5 Prozent dunkler machen"). At 0.6 the card in
 * front and the page behind sit close enough in value that the eye keeps
 * reading the page, which is the one thing a scrim exists to stop.
 *
 * It matches GlimStone's `--glim-scrim`, so the two surfaces dim by the same
 * amount rather than by two numbers that happen to look similar.
 */
export const SCRIM = "rgba(0, 0, 0, 0.65)";
