import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ShopperApp from '@/features/secretshoppers/ShopperApp'

// Entry for ss.html, the Secret Shopper phone app (/ss). Just the shopper
// flow: no Operator login, router or app shell.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShopperApp />
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
