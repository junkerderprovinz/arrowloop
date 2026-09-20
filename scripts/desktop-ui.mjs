// Builds the interface and copies it where the desktop shell embeds it.
//
// Wails resolves `frontend:dir` inside the desktop module and Go embeds relative
// to the package, so the shell needs its own copy. A stale copy is invisible, so
// this runs as wails.json's `frontend:build` on every `wails build` and
// `wails dev`.

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { version, writeWindowsVersion } from './stamp.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'web', 'dist')
const target = join(root, 'desktop', 'frontend', 'dist')

// One fixed string through a shell: Node refuses to spawn npm's .cmd without a
// shell, and deprecates an argument array with one (DEP0190).
const built = spawnSync('npm run build', {
  cwd: join(root, 'web'),
  stdio: 'inherit',
  shell: true,
})
if (built.status !== 0) {
  console.error('the interface did not build, so the shell would embed a stale copy')
  process.exit(built.status ?? 1)
}

// Replaced rather than merged, so a file removed from the interface leaves the
// shell too.
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })

// The embed directive needs the directory in a fresh clone.
writeFileSync(join(target, '.gitkeep'), '')

// Wails reads the version resource after frontend:build and before it compiles.
writeWindowsVersion()

console.log(`interface copied into the shell: ${readdirSync(target).length} entries, stamped ${version()}`)
