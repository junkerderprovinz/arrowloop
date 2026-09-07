import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Gate } from './App'
import { applyCachedAppearance } from './lib/appearance'
import { applyStoredLabelModes } from './lib/controls'
import { setGlyphResolver } from './lib/glimstone/glyphs'
import { glyphFor } from './lib/glyphFor'
import { applyStoredLanguage, I18nProvider } from './lib/i18n'
import { applyStoredMotion } from './lib/motion'
import './index.css'
// The flag sprites the language list draws from. MIT, and bundled rather than
// fetched: this interface runs on machines with no route to the internet, which
// is half the point of syncing files on your own hardware.
import 'flag-icons/css/flag-icons.min.css'

// The look and the language are applied before React renders anything, so the
// page never paints once in the default colours and then again in the chosen
// ones, and a right-to-left page never arrives the wrong way round and swaps.
applyCachedAppearance()
applyStoredLanguage()
applyStoredMotion()
applyStoredLabelModes()

/**
 * The one place GlimStone asks the app what its own marks are.
 *
 * The language ships no icon set on purpose: which glyph means "preview a run"
 * is this product's vocabulary, not the language's. Registering the mapping here
 * rather than passing a glyph at every call site is what lets the label engine
 * show a button in glyph-only mode at all, because a button that was never
 * handed an icon has nothing to draw when the words go away.
 *
 * The mapping itself moved into lib/glyphFor.tsx when it outgrew a switch. It
 * was eight keys against roughly forty buttons, so most of the app fell back to
 * text in a mode that is supposed to hide it - visible as a strip of half
 * symbols and half words, and findable only by looking.
 */
setGlyphResolver(glyphFor)

// The theme attribute is always written, and it is written from the device's
// own setting when nobody has chosen. Leaving the attribute off and relying on
// a media query works right up until somebody picks the theme their device is
// not set to, so there is one path here rather than two.
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
