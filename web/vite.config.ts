import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `//go:embed all:dist` fails to compile on an empty directory, and emptyOutDir
// deletes the committed keep-file along with the old output.
function keepDist() {
  return {
    name: 'arrowloop-keep-dist',
    closeBundle() {
      writeFileSync(resolve(__dirname, 'dist/.gitkeep'), '')
    },
  }
}

// The dev server proxies /api to a locally running `arrowloop web`.
export default defineConfig({
  plugins: [react(), keepDist()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8422', changeOrigin: true },
    },
  },
})
