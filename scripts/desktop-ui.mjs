// Builds the interface and puts it where the desktop shell embeds it.
//
// The shell needs its own copy. Wails resolves `frontend:dir` inside the
// desktop module and Go embeds relative to the package, so the one directory
// two modules could share would need a build tag on each side; a copy is less
// machinery. The cost of a copy is that it can be stale, and a stale copy is
// invisible: the shell builds, starts, and shows an interface from whenever
// somebody last remembered. That happened on 2026-09-06, and the delivered
// binary was missing a day of work while every test was green.
//
// So this runs from wails.json's `frontend:build`, which means it runs on every
// `wails build` and `wails dev`, on a laptop exactly as in CI. There is no path
// left that produces a shell without also producing the interface inside it.

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { version, writeWindowsVersion } from './stamp.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'web', 'dist')
const target = join(root, 'desktop', 'frontend', 'dist')

// One string through a shell, rather than a command plus an argument array.
// On Windows npm is a .cmd, and since the 2024 argument-injection fix Node
// refuses to spawn one without a shell at all; passing an argument array WITH a
// shell is what Node deprecated in DEP0190, because those arguments are
// concatenated rather than escaped. A fixed string with nothing interpolated
// into it sidesteps both, and prints no warning on every build.
const built = spawnSync('npm run build', {
  cwd: join(root, 'web'),
  stdio: 'inherit',
  shell: true,
})
if (built.status !== 0) {
  console.error('the interface did not build, so the shell would embed a stale copy')
  process.exit(built.status ?? 1)
}

// Replaced rather than merged: a file that leaves the interface has to leave
// the shell too, and merging would keep it forever.
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })

// The directory has to exist in a fresh clone for the embed directive to
// resolve at all, and git does not track empty directories.
writeFileSync(join(target, '.gitkeep'), '')

// The version resource, written here for the same reason the copy above is:
// this runs on every build, so the stamp can never be the step somebody
// forgot. Wails reads the file after frontend:build and before it compiles.
writeWindowsVersion()

console.log(`interface copied into the shell: ${readdirSync(target).length} entries, stamped ${version()}`)
