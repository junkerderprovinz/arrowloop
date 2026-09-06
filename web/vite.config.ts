import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Put back the file that makes the Go build work.
 *
 * The binary embeds dist with `//go:embed all:dist`, and that directive fails
 * to compile when the directory holds nothing at all. So one empty file is
 * committed to keep the directory in the repository, and this puts it back
 * after every build, because emptying the output directory is otherwise exactly
 * what we want and it takes the keep-file with it.
 *
 * Found the hard way: the file was committed, the next `npm run build` deleted
 * it, and every Go job in CI failed on a fresh clone with "pattern all:dist: no
 * matching files found" while every local build stayed green, because a local
 * dist is full of real output.
 */
function keepDist() {
  return {
    name: 'arrowloop-keep-dist',
    closeBundle() {
      writeFileSync(resolve(__dirname, 'dist/.gitkeep'), '')
    },
  }
}

// The build lands in dist/, which the Go binary embeds. The dev server proxies
// /api to a locally running `arrowloop web`, so the interface can be worked on
// against a real engine rather than against invented data.
export default defineConfig({
  plugins: [react(), keepDist()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8422', changeOrigin: true },
    },
  },
})
