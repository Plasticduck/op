import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import DriverAssignApp from '@/features/driverassign/DriverAssignApp'

// Entry for driverassignment.html, the drivers' phone app (/driverassignment).
// Just the PIN-and-scan flow: no Operator login, router or app shell.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DriverAssignApp />
  </StrictMode>,
)

// Same passthrough service worker as Operator; it helps Android offer
// "Install app" for the home screen.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* ignore registration failures */
    })
  })
}
