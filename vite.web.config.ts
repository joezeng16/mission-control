// The renderer alone in a normal browser with mock data (no Electron): npm run dev:web -> http://127.0.0.1:5199
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') } },
  plugins: [react(), tailwindcss()],
  define: { __MC_WEB_PREVIEW__: 'true' },   // sample data (lib/api.ts)
  server: { host: '127.0.0.1', port: 5199, strictPort: true }
})
