// Where the system colour comes from. The desktop app asks its shell, which
// reads the accent the operating system is set to (desktop/accent). A browser
// reads CSS AccentColor, which only Firefox and Safari fill with the system's
// colour, so in every other browser there is no source and no wand swatch.

import { setSystemAccent } from './appearance'
import { watchBrowserAccent } from './browserAccent'
import { inDesktopWindow } from './desk'
import { at } from './base'

/** The colour in the shell's answer, or undefined where the desktop has none. */
export function accentFrom(body: unknown): string | undefined {
  const accent = (body as { accent?: unknown } | null)?.accent
  return typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent) ? accent : undefined
}

async function desktopAccent(): Promise<string | undefined> {
  const res = await fetch(at('/api/window/accent'))
  if (!res.ok) throw new Error(res.statusText)
  return accentFrom(await res.json())
}

/**
 * Feeds setSystemAccent from this page's source, now and whenever the window
 * comes back to the front, which is when somebody returns from the system's
 * settings. Returns the function that stops watching.
 */
export function watchSystemAccent(desktop = inDesktopWindow()): () => void {
  if (!desktop) return watchBrowserAccent(setSystemAccent)
  // A shell that does not answer leaves the colour it gave last.
  const ask = () => void desktopAccent().then(setSystemAccent, () => {})
  ask()
  window.addEventListener('focus', ask)
  return () => window.removeEventListener('focus', ask)
}
