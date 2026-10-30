import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startDeviceHeartbeat } from './lib/itHeartbeat'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Tablets and kiosk browsers linked to their IT Inventory record report in
// while Operator is open (no-op everywhere else).
startDeviceHeartbeat()

// Register the PWA service worker (installable + notification routing).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* ignore registration failures (e.g. unsupported context) */
    })
  })
}
