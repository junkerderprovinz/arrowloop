// Appearance is the set of looks the user owns: how rounded the interface is,
// how much it moves, and what colour it uses for activity, either one accent or
// a palette handed out by position. All of it is applied to the document root,
// so every component picks it up through the tokens it already reads.
//
// The file has no framework dependency, since an adopting app copies it whole;
// a React app wraps it in a small hook.

export type Shape = 'round' | 'soft' | 'square';

export const SHAPES: Shape[] = ['round', 'soft', 'square'];

/**
 * The built-in accent, shared by every adopting app so the family opens in one
 * colour. Empty in settings means this.
 */
export const DEFAULT_ACCENT = '#FCC419';

/**
 * The accent presets, the same eight in the same order in every adopting app,
 * so "Blue" in one app is the same blue in the next. The picker allows any
 * colour; this list is a shortcut. The last three come from the rainbow palette
 * so both rows draw on one family.
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
 * The default palette: a full turn of the wheel in the same register as the
 * accent presets. The length is fixed, because colours are handed out by
 * position and a longer palette would recolour every existing row.
 */
export const RAINBOW: string[] = [
  '#FF8389', // red 30
  '#FF832B', // orange 40
  '#FCC419', // sunflower, the default accent, so one row always matches it
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

/** Sets the attribute the radius tokens key off. */
export function applyShape(shape: Shape | string | undefined): void {
  const s = SHAPES.includes(shape as Shape) ? (shape as Shape) : 'round';
  document.documentElement.setAttribute('data-shape', s);
}

/**
 * The motion levels, quietest first. The tokens in tokens.css key off
 * `data-motion` on the root.
 *
 * These strings go into the attribute, the stylesheet selectors and storage, so
 * renaming one makes a saved value fail validation and fall back to
 * DEFAULT_MOTION. What the user reads comes from the translation table.
 *
 * `storm` is a real level (see `data-motion='storm'` in tokens.css) that no
 * picker offers; `stormTap` reveals it.
 */
export type Motion = 'off' | 'subtle' | 'wild' | 'storm';

/** The levels a picker shows. */
export const MOTION_LEVELS: Motion[] = ['off', 'subtle', 'wild'];

/**
 * The levels a stored value may hold. Validate against this and populate a
 * picker from MOTION_LEVELS, or a found storm forgets itself on reload.
 */
export const MOTION_STORED: Motion[] = [...MOTION_LEVELS, 'storm'];

/**
 * The default is the middle level, because the top one is a statement rather
 * than polish. A changed default does not reach a stored choice, so an app that
 * shipped another default needs a migration for any stored spelling that meant
 * the top level.
 */
export const DEFAULT_MOTION: Motion = 'subtle';

/** Sets the attribute the motion tokens key off. */
export function applyMotion(motion: Motion | string | undefined): void {
  // A storm somebody found must survive a reload, so the stored set is checked.
  const m: Motion = MOTION_STORED.includes(motion as Motion) ? (motion as Motion) : DEFAULT_MOTION;
  document.documentElement.setAttribute('data-motion', m);
}

/** How many taps on `wild`, once it is chosen, reveal the storm. */
export const STORM_TAPS = 5;

/**
 * The gesture that reveals the storm: with motion at `wild`, tap `wild` five
 * more times. Tapping any other level resets the count, since five taps on
 * "off" mean somebody is annoyed rather than curious.
 *
 * An easter egg that changes behaviour must be switchable off and must not
 * become a permanent settings entry. So the storm is offered while it is chosen,
 * and otherwise only while the screen that found it stays open: keep `found`
 * and the count in that screen's state, never in storage.
 *
 * Returns the level to switch to, or undefined when the tap was not the fifth.
 */
export function stormTap(state: { taps: number }, tapped: string, current: string): Motion | undefined {
  if (tapped !== 'wild' || current !== 'wild') {
    state.taps = 0;
    return undefined;
  }
  state.taps += 1;
  if (state.taps < STORM_TAPS) return undefined;
  state.taps = 0;
  return 'storm';
}

/*
 * The storm is the one level that outranks the operating system's reduced
 * motion setting. Somebody with reduced motion never chose `off`, `subtle` or
 * `wild`; they got whatever the app booted at, so those levels live inside
 * `@media (prefers-reduced-motion: no-preference)`. Five taps on a chosen option
 * are a deliberate request, so tokens.css exempts the storm inside the (reduce)
 * block, where the gentler substitutes live, and restores the full animation
 * there; exempting it without restoring would leave it with none, or invisible
 * where the resting state is `opacity: 0`. The exemption stops at infinite
 * animations: `.glim-live`'s pulse keeps its stop at every level.
 */

/**
 * Overrides the accent tokens, or clears the override so the theme's gold comes
 * back. The contrast colour is computed, so a light accent never gets white
 * text.
 *
 * `--accent-ink` is not set here: tokens.css derives it from --accent with
 * color-mix, so it also follows a later light or dark switch.
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

// The rainbow state belongs to the document, not a component: the sidebar and a
// list far away in the tree must agree on which colour position three is, so
// readers subscribe.
let state: RainbowState = RAINBOW_OFF;
const listeners = new Set<() => void>();

/** The current snapshot, with a stable identity between changes. */
export function rainbowState(): RainbowState {
  return state;
}

export function subscribeRainbow(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Stores the new state, mirrors it onto the document root and wakes the
 * readers. The `--rb-N` and `--rb-ink-N` properties are set even when the mode
 * is off, because hueVars() points every hued element at them; the
 * `data-rainbow` attribute is what turns the look on.
 */
export function applyRainbow(next: Partial<RainbowState> | undefined): void {
  const merged: RainbowState = { ...RAINBOW_OFF, ...next };
  merged.palette = usablePalette(merged.palette);
  merged.seed = Number.isFinite(merged.seed) ? Math.abs(Math.trunc(merged.seed)) % RAINBOW.length : 0;
  state = merged;

  const root = document.documentElement;
  for (let i = 0; i < RAINBOW.length; i++) {
    root.style.setProperty(`--rb-${i}`, rainbowAt(i));
    root.style.setProperty(`--rb-ink-${i}`, contrastOn(rainbowAt(i)));
  }
  if (!merged.on) root.removeAttribute('data-rainbow');
  else root.setAttribute('data-rainbow', merged.reactive ? 'reactive' : 'on');

  for (const fn of listeners) fn();
}

/**
 * The colour at a position, rotation applied. It answers even when the mode is
 * off, because a settings page shows the palette it edits.
 */
export function rainbowAt(i: number): string {
  const p = state.palette;
  const off = state.rotate ? state.seed : 0;
  const n = ((Math.trunc(i) % p.length) + p.length) % p.length;
  const color = p[(n + off) % p.length];
  if (color === undefined) {
    // usablePalette never leaves the palette empty; this narrows the type.
    throw new Error('rainbowAt: palette is empty');
  }
  return color;
}

/**
 * The colour an item should use, or undefined when the mode is off. Undefined
 * rather than the accent keeps the accent in CSS, where a theme change reaches
 * it.
 */
export function rainbowColor(i: number): string | undefined {
  return state.on ? rainbowAt(i) : undefined;
}

/**
 * The inline custom properties an element at palette position `i` sets on
 * itself. The `.glim-hue` rules in tokens.css decide whether the hue shows at
 * rest or on hover, so a component names its position and never the mode.
 *
 * They point at the root's `--rb-*` properties rather than holding a colour,
 * so a palette or rotation change lands on the root alone, and disco can walk
 * the colours there without re-rendering a single component.
 *
 * The class and these properties travel together: `.glim-hue` with no
 * `--item-hue` under it resolves the accent to nothing.
 */
export function hueVars(i: number): Record<string, string> {
  const n = ((Math.trunc(i) % RAINBOW.length) + RAINBOW.length) % RAINBOW.length;
  const hue = `var(--rb-${n})`;
  return {
    '--item-hue': hue,
    '--item-hue-ink': `var(--rb-ink-${n})`,
    '--item-hue-soft': `color-mix(in srgb, ${hue} 22%, transparent)`,
    // The wash covers a whole row, so it sits below the soft tint. Below 16%
    // people could not tell the rows apart from the ground.
    '--item-hue-wash': `color-mix(in srgb, ${hue} 16%, transparent)`,
    // A small circular badge has no neighbouring rows to repeat its colour and
    // reads as grey at the wash's 16%, so it gets its own tier.
    '--item-hue-badge': `color-mix(in srgb, ${hue} 50%, transparent)`,
    // Without this a gold focus ring would sit around a teal tab.
    '--item-hue-ring': `color-mix(in srgb, ${hue} 55%, transparent)`,
  };
}

/**
 * Maps a server's flat fields onto the state this module keeps. The parameter
 * is structural so this file can be copied into an app unchanged.
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

/** A palette is taken only in full, matching the rule on the server. */
function usablePalette(p: string[] | undefined): string[] {
  if (!p || p.length !== RAINBOW.length || !p.every(valid)) return RAINBOW;
  return p;
}

/** Black or white, whichever is readable on the given colour. */
export function contrastOn(hex: string): string {
  if (!valid(hex)) return '#FFFFFF';
  const { r, g, b } = parse(hex);
  // Carbon's own ink: on a yellow accent a brown-tinted black reads as a smudge.
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
 * Relative luminance, used to pick black or white on top. The channels are
 * linearised first because raw sRGB overstates blue and understates green.
 */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Appearance is mirrored into localStorage only so the first paint after a
// reload is right; wherever settings live stays the source of truth. Each app
// should use its own key.
const CACHE = 'glim-appearance';

interface Cached {
  shape?: string;
  accent?: string;
  rainbow?: RainbowState;
}

export function cacheAppearance(shape: string, accent: string, rainbow?: RainbowState): void {
  try {
    // The conditional spread omits the key under exactOptionalPropertyTypes
    // instead of storing it as undefined.
    const payload: Cached = { shape, accent, ...(rainbow !== undefined ? { rainbow } : {}) };
    localStorage.setItem(CACHE, JSON.stringify(payload));
  } catch {
    // With storage disabled the default look flashes once per load.
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
