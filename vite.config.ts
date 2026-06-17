import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // The shared vendor chunk (React, router, supabase-js, TanStack Table) is
    // ~160 kB gzipped and required by every route; per-page chunks are tiny.
    chunkSizeWarningLimit: 700,
  },
})
