import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  // everything is bundled (externalizeDeps off), so the packaged app ships no node_modules folder
  main: { resolve: { alias: shared }, build: { externalizeDeps: false } },
  preload: { resolve: { alias: shared }, build: { externalizeDeps: false } },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    define: { __MC_WEB_PREVIEW__: 'false' },   // the app never falls back to sample data
    build: { minify: true, chunkSizeWarningLimit: 1000 }   // one local bundle; no network cost
  }
})
