// Which ramp is showing, and the OLED variant of the dark one. The theme
// itself is `data-theme` on <html>, `light`, `dark` or unset for the system.
// OLED is `data-oled` on <html>, present or absent; tokens.css applies it only
// while the dark ramp shows, so it can stay on through a switch to light.
//
// OLED belongs to the screen, not the person, so it is kept on the device and
// never with settings a server syncs: the same account may sign in on an LCD
// laptop.

import { storageKey } from './storage.ts';

const SYSTEM_DARK = '(prefers-color-scheme: dark)';

/** Whether the dark ramp shows for a `data-theme` value and the system's preference. */
export function resolvesDark(theme: string | null | undefined, systemDark: boolean): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return systemDark;
}

/** Whether the dark ramp is showing now, by choice or because the system is dark. */
export function darkShowing(): boolean {
  return resolvesDark(document.documentElement.getAttribute('data-theme'), matchMedia(SYSTEM_DARK).matches);
}

/**
 * Calls `fn` whenever the dark ramp starts or stops showing, through a theme
 * choice or the system, so a settings page can say whether OLED is in effect.
 * Returns the function that stops watching.
 */
export function watchDarkShowing(fn: (dark: boolean) => void): () => void {
  let last = darkShowing();
  const check = () => {
    const next = darkShowing();
    if (next === last) return;
    last = next;
    fn(next);
  };
  const media = matchMedia(SYSTEM_DARK);
  media.addEventListener('change', check);
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    media.removeEventListener('change', check);
    observer.disconnect();
  };
}

/** Turns OLED on or off and remembers it on this device. */
export function applyOled(on: boolean): void {
  const root = document.documentElement;
  if (on) root.setAttribute('data-oled', '');
  else root.removeAttribute('data-oled');
  try {
    if (on) localStorage.setItem(storageKey('oled'), '1');
    else localStorage.removeItem(storageKey('oled'));
  } catch {
    // The switch still holds until the page closes.
  }
}

/**
 * Whether the OLED switch may be flipped under a theme choice: `dark`,
 * `light`, or `system` and null for following the device. Under System it may,
 * for the device's dark.
 */
export function oledSwitchable(theme: string | null | undefined): boolean {
  return theme !== 'light';
}

/** The words of the OLED switch's refusal, translated by the app. */
export interface OledRefusalText {
  /** The sentence, with `{dark}`, `{system}` and `{light}` for the theme names. */
  sentence: string;
  /** The theme names as the Design picker shows them. */
  dark: string;
  system: string;
  light: string;
}

/** English words, for an app in English and for the demos. */
export const oledRefusalEn: OledRefusalText = {
  sentence: 'Only with {dark} or {system}. {light} is chosen above.',
  dark: 'Dark',
  system: 'System',
  light: 'Light',
};

/**
 * Why the OLED switch refuses under a theme choice, or undefined while it may
 * be flipped. Hand it to the switch's `refused`.
 */
export function oledRefusal(theme: string | null | undefined, text: OledRefusalText = oledRefusalEn): string | undefined {
  if (oledSwitchable(theme)) return undefined;
  return text.sentence.replace(/\{(dark|system|light)\}/g, (_, name: 'dark' | 'system' | 'light') => text[name]);
}

/** Whether OLED is on for this device. */
export function storedOled(): boolean {
  try {
    return localStorage.getItem(storageKey('oled')) === '1';
  } catch {
    return false;
  }
}
