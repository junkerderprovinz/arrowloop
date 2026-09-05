import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { applyCachedAppearance } from './lib/appearance'
import './index.css'

// The look is applied before React renders anything, so the page never paints
// once in the default colours and then again in the chosen ones.
applyCachedAppearance()
const stored = (() => {
  try {
    return localStorage.getItem('reeveroll.theme')
  } catch {
    return null
  }
})()
if (stored === 'dark' || stored === 'light') {
  document.documentElement.setAttribute('data-theme', stored)
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
