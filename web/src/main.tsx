import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Gate } from './App'
import { applyCachedAppearance } from './lib/appearance'
import { applyStoredLabelModes } from './lib/controls'
import { setGlyphResolver } from './lib/glimstone/glyphs'
import { glyphFor } from './lib/glyphFor'
import { applyStoredLanguage, I18nProvider } from './lib/i18n'
import { applyStoredMotion } from './lib/motion'
import '@fontsource-variable/noto-sans'
import '@fontsource-variable/noto-sans-arabic'
import '@fontsource-variable/noto-sans-hebrew'
import '@fontsource-variable/noto-sans-thai'
import './index.css'
// Bundled rather than fetched: the interface runs on machines with no route to
// the internet.
import 'flag-icons/css/flag-icons.min.css'

// Applied before React renders, so the page never paints in the default colours
// first and a right-to-left page never arrives the wrong way round.
applyCachedAppearance()
applyStoredLanguage()
applyStoredMotion()
applyStoredLabelModes()

// Registered once rather than passed at every call site, so a button in
// glyph-only mode has a mark to draw even where nobody handed it one.
setGlyphResolver(glyphFor)

// The theme attribute is always written, from the device's setting when nobody
// has chosen, so the theme has one source rather than an attribute and a media
// query that disagree once somebody picks the other one.
const stored = (() => {
  try {
    return localStorage.getItem('arrowloop.theme')
  } catch {
    return null
  }
})()
document.documentElement.setAttribute(
  'data-theme',
  stored === 'dark' || stored === 'light'
    ? stored
    : window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark',
)

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <Gate />
      </I18nProvider>
    </StrictMode>,
  )
}
