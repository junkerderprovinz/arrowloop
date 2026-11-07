// The Design setting: dark, light, or whatever the device says. The theme
// attribute is always written, from the device's setting under System, so the
// stylesheet has one source rather than an attribute and a media query that
// disagree.

export type ThemeChoice = 'dark' | 'light' | 'system'

const KEY = 'arrowloop.theme'

const deviceQuery = () => window.matchMedia?.('(prefers-color-scheme: light)')

/** Nothing stored means System, which is also where a new install starts. */
export function storedTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // Storage turned off. The device setting still answers.
  }
  return 'system'
}

export function paintTheme(choice: ThemeChoice) {
  const theme = choice === 'system' ? (deviceQuery()?.matches ? 'light' : 'dark') : choice
  document.documentElement.setAttribute('data-theme', theme)
}

export function storeTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // A browser with storage disabled forgets the choice on reload.
  }
}

/** Repaints when the device switches while System is chosen. */
export function followDevice(choice: ThemeChoice): () => void {
  const media = deviceQuery()
  if (!media || choice !== 'system') return () => {}
  const follow = () => paintTheme('system')
  media.addEventListener('change', follow)
  return () => media.removeEventListener('change', follow)
}
