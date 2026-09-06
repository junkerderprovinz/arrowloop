import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { applyCachedAppearance } from './lib/appearance'
import { applyStoredLabelModes } from './lib/controls'
import { applyStoredLanguage, I18nProvider } from './lib/i18n'
import { applyStoredMotion } from './lib/motion'
import './index.css'

// The look and the language are applied before React renders anything, so the
// page never paints once in the default colours and then again in the chosen
// ones, and a right-to-left page never arrives the wrong way round and swaps.
applyCachedAppearance()
applyStoredLanguage()
applyStoredMotion()
applyStoredLabelModes()

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
        <App />
      </I18nProvider>
    </StrictMode>,
  )
}
