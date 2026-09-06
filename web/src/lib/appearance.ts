// Copied verbatim from GlimStone 1.6.0, reference/appearance.ts.
// Do not edit here: change it in the design language repo and copy again.
// https://github.com/junkerderprovinz/glimstone
// Appearance is the set of looks the user owns: how rounded the interface is,
// and what colour it uses for activity — one accent, or a palette handed out
// by position. All of it is applied to the document root, so every component
// picks it up through the tokens it already reads, and nothing has to be told
// about the change.
//
// This file stays free of any UI framework on purpose: it's the piece an
// adopting app copies wholesale, and a design language shouldn't arrive with
// a framework attached. A React app wraps it in a small hook; anything else
// calls the functions directly.

export type Shape = 'round' | 'soft' | 'square';

export const SHAPES: Shape[] = ['round', 'soft', 'square'];

/**
 * The built-in accent. Empty in settings means this.
 *
 * This is every adopting app's shared default, not a colour any one of them
 * owns: apps that share a design language but open in different colours by
 * default are a family only on paper.
 */
export const DEFAULT_ACCENT = '#FCC419';

/**
 * ACCENTS are the presets offered in the picker — the same EIGHT across every
 * adopting app, in the same order, so someone who set "Blue" in one app finds
 * the same blue in the next. Every one of them opens the picker, so the list is
 * a shortcut rather than a restriction.
 *
 * It was five here and eight in BombVault, which is the kind of drift a shared
 * list exists to prevent: the two rows sat at visibly different lengths, and
 * three colours somebody could pick in one app were simply absent in the other.
 * The last three are taken from the rainbow palette by position, which is where
 * BombVault took them from, so the accent row and the palette row below it draw
 * from one family rather than two.
 */
export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Sunflower', hex: '#FCC419' },
  { name: 'Blue', hex: '#1D99F3' },
  { name: 'Green', hex: '#6FDC8C' },
  { name: 'Red', hex: '#FF8389' },
  { name: 'Purple', hex: '#BE95FF' },
  { name: 'Orange', hex: '#FF832B' },
  { name: 'Teal', hex: '#3DDBD9' },
  { name: 'Magenta', hex: '#FF7EB6' },
];

/**
 * RAINBOW is the default palette: a full turn of the wheel, but tuned to the
 * same warm, slightly dusty register as the accent presets, so switching the
 * mode on changes how much colour there is, not which family it belongs to.
 * The length is fixed — colours are handed out by position, so a palette
 * that could grow would re-colour every existing row the moment one was
 * added.
 */
export const RAINBOW: string[] = [
  '#FF8389', // red 30
  '#FF832B', // orange 40
  '#FCC419', // sunflower — the default accent, so one row always matches it
  '#6FDC8C', // green 30
  '#3DDBD9', // teal 30
  '#1D99F3', // blue
  '#BE95FF', // purple 30
  '#FF7EB6', // magenta 30
];

export interface RainbowState {
  on: boolean;
  /** Rest neutral, colour on hover, keep the colour on the active item. */
  reactive: boolean;
  /** Offset the palette by seed, so a run does not always start on crimson. */
  rotate: boolean;
  seed: number;
  palette: string[];
}

export const RAINBOW_OFF: RainbowState = {
  on: false,
  reactive: false,
  rotate: false,
  seed: 0,
  palette: RAINBOW,
};

/** applyShape sets the attribute the radius tokens key off. */
export function applyShape(shape: Shape | string | undefined): void {
  const s = SHAPES.includes(shape as Shape) ? (shape as Shape) : 'round';
  document.documentElement.setAttribute('data-shape', s);
}

/**
 * applyAccent overrides the accent tokens, or clears the override so the
 * theme's own gold comes back. The contrast colour is computed rather than
 * configured: a light accent with white text on it is unreadable, and asking
 * the user to pick a second colour to fix the first one is not a setting, it
 * is a trap.
 *
 * `--accent-ink` is deliberately NOT set here. It is declared in tokens.css
 * as a color-mix over --accent, so it re-resolves on its own from whatever
 * this function writes AND follows a light/dark switch that happens later.
 * Computing it here would freeze it at the theme in force when the accent was
 * picked, which is exactly the bug the second token exists to avoid.
 */
export function applyAccent(hex: string | undefined): void {
  const root = document.documentElement.style;
  if (!valid(hex)) {
    root.removeProperty('--accent');
    root.removeProperty('--accent-contrast');
    root.removeProperty('--accent-soft');
    return;
  }
  const { r, g, b } = parse(hex);
  root.setProperty('--accent', hex);
  root.setProperty('--accent-contrast', contrastOn(hex));
  root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`);
}

// ---------------------------------------------------------------------------
// Rainbow
//
// The live state is module-level because it is a property of the document,
// not of any one component: the sidebar and the download list must agree on
// which colour position three is, and they never meet in the tree. Readers
// subscribe instead of being handed a prop through six intermediate
// components.
// ---------------------------------------------------------------------------

let state: RainbowState = RAINBOW_OFF;
const listeners = new Set<() => void>();

/** rainbowState is the current snapshot. Stable identity between changes. */
export function rainbowState(): RainbowState {
  return state;
}

export function subscribeRainbow(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * applyRainbow stores the new state, mirrors it onto the document root and
 * wakes the readers. The custom properties are set even when the mode is off
 * so that a stylesheet can reference `--rb-3` without having to know; the
 * `data-rainbow` attribute is what actually turns the look on.
 */
export function applyRainbow(next: Partial<RainbowState> | undefined): void {
  const merged: RainbowState = { ...RAINBOW_OFF, ...next };
  merged.palette = usablePalette(merged.palette);
  merged.seed = Number.isFinite(merged.seed) ? Math.abs(Math.trunc(merged.seed)) % RAINBOW.length : 0;
  state = merged;

  const root = document.documentElement;
  for (let i = 0; i < RAINBOW.length; i++) {
    root.style.setProperty(`--rb-${i}`, rainbowAt(i));
  }
  if (!merged.on) root.removeAttribute('data-rainbow');
  else root.setAttribute('data-rainbow', merged.reactive ? 'reactive' : 'on');

  for (const fn of listeners) fn();
}

/**
 * rainbowAt is the colour at a position, rotation applied. It answers even
 * when the mode is off, because a settings page has to show the palette it
 * is editing.
 */
export function rainbowAt(i: number): string {
  const p = state.palette;
  const off = state.rotate ? state.seed : 0;
  const n = ((Math.trunc(i) % p.length) + p.length) % p.length;
  const color = p[(n + off) % p.length];
  if (color === undefined) {
    // Unreachable in practice: usablePalette() never lets state.palette go
    // empty, but the index is computed via modulo, which TS can't verify.
    throw new Error('rainbowAt: palette is empty');
  }
  return color;
}

/**
 * rainbowColor is what a component asks for: the colour this item should
 * use, or undefined when the mode is off and the single accent applies.
 * Returning undefined rather than the accent keeps the accent in CSS, where
 * a theme change still reaches it.
 */
export function rainbowColor(i: number): string | undefined {
  return state.on ? rainbowAt(i) : undefined;
}

/**
 * hueVars are the inline custom properties an element carrying a palette
 * position sets on itself. The matching `.glim-hue` rules in tokens.css
 * decide whether the hue is shown at rest or held back until hover, so a
 * component only has to say which colour it owns, never which mode is
 * active.
 *
 * The class and these properties always travel together: `.glim-hue` with no
 * `--item-hue` under it would resolve the accent to nothing. Hand out both
 * from one call in the adopting app's own component layer.
 */
export function hueVars(hex: string | undefined): Record<string, string> {
  if (!valid(hex)) return {};
  const { r, g, b } = parse(hex);
  return {
    '--item-hue': hex,
    '--item-hue-ink': contrastOn(hex),
    '--item-hue-soft': `rgba(${r}, ${g}, ${b}, 0.22)`,
    // The wash covers a whole row, so it sits below the soft tint - but not
    // as far below as the original 7% figure: three independent adopting-app
    // reports said the mode "does nothing" at that strength, and measuring
    // the actual rendered colour confirmed the mechanism was wiring
    // correctly (the values genuinely differed row to row) while staying
    // under the threshold a person registers as "this changed." 16% is the
    // new floor - still short of 22%'s "colour chart" territory, but no
    // longer indistinguishable from the ground colour at a glance.
    '--item-hue-wash': `rgba(${r}, ${g}, ${b}, 0.16)`,
    // A compact circular badge (an icon toggle, an undo/redo/zoom action) has
    // no neighbouring row to reinforce the colour by repetition the way a
    // list does, and reads as barely-tinted grey at the wash's own 16% once
    // shrunk to badge size (jdp, adopting app: "die ganzen icon badges sind
    // immer noch schwach eingefärbt, die sollen normal kräftig eingefärbt
    // sein"). This tier is deliberately separate from the wash above rather
    // than just raising it - a list row's own 16% is calibrated for a
    // DIFFERENT reason (rule above: dense/at-scale is exactly where subtlety
    // matters) and must stay put.
    '--item-hue-badge': `rgba(${r}, ${g}, ${b}, 0.5)`,
    // The focus ring follows the position too. A gold ring around a teal tab
    // is the one place the single accent leaks back into the plural mode, and
    // it is the most visible one, because it only ever appears on the element
    // the keyboard is standing on.
    '--item-hue-ring': `rgba(${r}, ${g}, ${b}, 0.55)`,
  };
}

/**
 * rainbowFromSettings maps a server's flat fields onto the state this module
 * keeps. The parameter is structural rather than an imported type so this
 * file can be lifted into an adopting app unchanged.
 */
export function rainbowFromSettings(s: {
  rainbow?: boolean;
  rainbowReactive?: boolean;
  rainbowRotate?: boolean;
  rainbowSeed?: number;
  rainbowPalette?: string[] | null;
}): RainbowState {
  return {
    on: !!s.rainbow,
    reactive: !!s.rainbowReactive,
    rotate: !!s.rainbowRotate,
    seed: s.rainbowSeed ?? 0,
    palette: usablePalette(s.rainbowPalette ?? undefined),
  };
}

/** A palette is taken only in full — see the matching rule on the server. */
function usablePalette(p: string[] | undefined): string[] {
  if (!p || p.length !== RAINBOW.length || !p.every(valid)) return RAINBOW;
  return p;
}

/** contrastOn is black or white, whichever is readable on the given colour. */
export function contrastOn(hex: string): string {
  if (!valid(hex)) return '#FFFFFF';
  const { r, g, b } = parse(hex);
  // Carbon's own ink, not a warm near-black: on a yellow accent a
  // brown-tinted black reads as a smudge.
  return luminance(r, g, b) > 0.55 ? '#161616' : '#FFFFFF';
}

function valid(hex: string | undefined): hex is string {
  return !!hex && /^#[0-9a-fA-F]{6}$/.test(hex);
}

function parse(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * luminance is the perceptual brightness used to decide black or white on
 * top. The sRGB channels are linearised first, because the raw values
 * overstate how bright blue is and understate green, which is exactly the
 * case that produces unreadable buttons.
 */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Appearance is mirrored into localStorage purely so the first paint after a
 * reload is already right. The server (or wherever settings actually live)
 * stays the source of truth; this only avoids a flash of the default look
 * while they are being fetched. Each adopting app should use its own cache
 * key — this default is just a starting point.
 */
const CACHE = 'glim-appearance';

interface Cached {
  shape?: string;
  accent?: string;
  rainbow?: RainbowState;
}

export function cacheAppearance(shape: string, accent: string, rainbow?: RainbowState): void {
  try {
    // Built with a conditional spread, not `{ shape, accent, rainbow }`, so
    // that under exactOptionalPropertyTypes the key is omitted entirely
    // when there's no rainbow state rather than present-but-undefined.
    const payload: Cached = { shape, accent, ...(rainbow !== undefined ? { rainbow } : {}) };
    localStorage.setItem(CACHE, JSON.stringify(payload));
  } catch {
    // A browser with storage disabled simply pays one flash per load.
  }
}

/** Applied at boot, before the app renders anything. */
export function applyCachedAppearance(): void {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!raw) {
      applyShape('round');
      applyRainbow(undefined);
      return;
    }
    const { shape, accent, rainbow } = JSON.parse(raw) as Cached;
    applyShape(shape);
    applyAccent(accent);
    applyRainbow(rainbow);
  } catch {
    applyShape('round');
    applyRainbow(undefined);
  }
}
