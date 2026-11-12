import path from 'node:path'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// /ss is the Secret Shopper phone app, its own page (ss.html) with its own
// home-screen manifest. vercel.json rewrites /ss to it in production; this
// does the same for `vite` and `vite preview`.
const rewriteSs: Connect.NextHandleFunction = (req, _res, next) => {
  const [p, q] = (req.url ?? '').split('?')
  if (p === '/ss' || p === '/ss/') req.url = `/ss.html${q ? `?${q}` : ''}`
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
      },
    },
  },
})
