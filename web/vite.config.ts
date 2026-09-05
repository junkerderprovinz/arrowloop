import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The build lands in dist/, which the Go binary embeds. The dev server proxies
// /api to a locally running `reeveroll web`, so the interface can be worked on
// against a real engine rather than against invented data.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8422', changeOrigin: true },
    },
  },
})
