import path from 'node:path'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// /shop is the Secret Shopper phone app, its own page (shop.html) with its own
// home-screen manifest. vercel.json rewrites /shop to it in production; this
// does the same for `vite` and `vite preview`.
const rewriteShop: Connect.NextHandleFunction = (req, _res, next) => {
  const [p, q] = (req.url ?? '').split('?')
  if (p === '/shop' || p === '/shop/') req.url = `/shop.html${q ? `?${q}` : ''}`
  next()
}
const shopPage: Plugin = {
  name: 'shop-page',
  configureServer: (server) => { server.middlewares.use(rewriteShop) },
  configurePreviewServer: (server) => { server.middlewares.use(rewriteShop) },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), shopPage],
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
        shop: path.resolve(__dirname, 'shop.html'),
      },
    },
  },
})
