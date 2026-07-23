import { useCallback, useEffect, useState } from 'react'

// Light/dark theming. The app is built on semantic color tokens (see index.css);
// toggling the `dark` class on <html> re-points those tokens for the whole UI.
// The initial class is set by a tiny inline script in index.html so there is no
// flash of the wrong theme before React mounts.
export type Theme = 'light' | 'dark' | 'system'
const KEY = 'wl-theme'

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(t: Theme): 'light' | 'dark' {
  return t === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : t
}

function applyResolved(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0d1219' : '#0b0f14')
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // ignore persistence failures
  }
  applyResolved(resolveTheme(t))
  window.dispatchEvent(new CustomEvent('wl:themechange'))
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(getStoredTheme()))

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystem = () => {
      if (getStoredTheme() === 'system') {
        const r = resolveTheme('system')
        setResolved(r)
        applyResolved(r)
      }
    }
    const onChange = () => {
      const t = getStoredTheme()
      setThemeState(t)
      setResolved(resolveTheme(t))
    }
    mq.addEventListener('change', onSystem)
    window.addEventListener('wl:themechange', onChange)
    return () => {
      mq.removeEventListener('change', onSystem)
      window.removeEventListener('wl:themechange', onChange)
    }
  }, [])

  const set = useCallback((t: Theme) => {
    setTheme(t)
    setThemeState(t)
    setResolved(resolveTheme(t))
  }, [])

  return { theme, resolved, setTheme: set }
}
