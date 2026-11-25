import path from 'node:path'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// /ss is the Secret Shopper phone app and /driverassignment the drivers' one,
// each its own page (ss.html, driverassignment.html) with its own home-screen
// manifest. vercel.json rewrites them in production; this does the same for
// `vite` and `vite preview`.
const PHONE_APPS = ['ss', 'driverassignment']
const rewriteSs: Connect.NextHandleFunction = (req, _res, next) => {
  const [p, q] = (req.url ?? '').split('?')
  const app = PHONE_APPS.find((a) => p === `/${a}` || p === `/${a}/`)
  if (app) req.url = `/${app}.html${q ? `?${q}` : ''}`
  next()
}
const ssPage: Plugin = {
  name: 'ss-page',
  configureServer: (server) => { server.middlewares.use(rewriteSs) },
  configurePreviewServer: (server) => { server.middlewares.use(rewriteSs) },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ssPage],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // The shared vendor chunk (React, router, supabase-js, TanStack Table) is
    // ~160 kB gzipped and required by every route; per-page chunks are tiny.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        ss: path.resolve(__dirname, 'ss.html'),
        driverassignment: path.resolve(__dirname, 'driverassignment.html'),
      },
    },
  },
})
