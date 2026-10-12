import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Gate } from './App'
import { armShapeTransitions } from './lib/animate'
import { applyCachedAppearance } from './lib/appearance'
import { applyStoredLabelModes, BOTTOM_BAR_AXIS } from './lib/controls'
import { applyDisco } from './lib/disco'
import { getDisco } from './lib/discoSetting'
import { setGlyphResolver } from './lib/glimstone/glyphs'
import { glyphFor } from './lib/glyphFor'
import { applyStoredLanguage, I18nProvider } from './lib/i18n'
import { applyStoredMotion } from './lib/motion'
import { paintTheme, storedTheme } from './lib/theme'
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
// Disco walks the rainbow's colours, so it starts once they are applied.
applyDisco(getDisco())
applyStoredLanguage()
applyStoredMotion()
applyStoredLabelModes([BOTTOM_BAR_AXIS])
paintTheme(storedTheme())

// Registered once rather than passed at every call site, so a button in
// glyph-only mode has a mark to draw even where nobody handed it one.
setGlyphResolver(glyphFor)

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <Gate />
      </I18nProvider>
    </StrictMode>,
  )
  armShapeTransitions()
}
