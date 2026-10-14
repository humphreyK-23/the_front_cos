import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Fade out the loading screen (index.html) once the app is up. Keep it at
// least briefly so it does not just flash on fast connections.
const SPLASH_MIN_MS = 1400
const splash = document.getElementById('splash')
if (splash) {
  const shownFor = performance.now()
  setTimeout(() => {
    splash.classList.add('hide')
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
  }, Math.max(0, SPLASH_MIN_MS - shownFor))
}

// Installable app: cache the app and floor plans for weak Wi-Fi, and pick up
// new versions automatically when they are deployed.
registerSW({ immediate: true })
