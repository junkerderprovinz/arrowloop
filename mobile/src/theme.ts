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
 * resolved by a browser, and there is no browser here. A generator could read
 * that file, and it would be one more moving part for eighteen numbers that
 * change about once a year. The guard against drift is the test beside this
 * file, which reads tokens.css and holds these to it.
 */

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
  accent: string;
  accentContrast: string;
  ok: string;
  fail: string;
  warn: string;
  neutral: string;
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
  accent: "#FCC419",
  accentContrast: "#161616",
  ok: "#6fdc8c",
  fail: "#ff8389",
  warn: "#FCC419",
  neutral: "#8d8d8d",
};

const light: Palette = {
  background: "#ffffff",
  surface: "#ffffff",
  surface2: "#e8e8e8",
  surface3: "#d1d1d1",
  hover: "#e0e0e0",
  border: "#d1d1d1",
  text: "#161616",
  textSub: "#525252",
  textMuted: "#6f6f6f",
  accent: "#8E6A00",
  accentContrast: "#ffffff",
  ok: "#0e6027",
  fail: "#da1e28",
  warn: "#8E6A00",
  neutral: "#6f6f6f",
};

export const palettes: Record<Scheme, Palette> = { dark, light };

/**
 * The type scale, and it is NOT the web's.
 *
 * GlimStone's sizes are in rem against a 16px root; a phone reads at arm's
 * length rather than at desk distance, and Android's own scale starts at 14sp
 * for body text where the web starts at 14px. So the ROLES are the same - a
 * heading, body, dense, caption - and the numbers are the phone's.
 */
export const text = {
  heading: 22,
  title: 17,
  body: 15,
  dense: 13,
  caption: 12,
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

/** Corner radii. `card` and `control` are GlimStone's own two. */
export const radius = {
  control: 8,
  card: 12,
  pill: 999,
} as const;

/**
 * The smallest thing a finger may be asked to hit.
 *
 * 48 is Android's own figure and it is a floor rather than a target. This is
 * the one number in this file with no counterpart on the web, and it is the
 * reason the screens here are not the desktop ones rearranged: a row that is
 * comfortable with a mouse is a coin toss with a thumb.
 */
export const TOUCH = 48;
