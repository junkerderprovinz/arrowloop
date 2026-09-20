// Builds both Windows executables with the same version stamped into both.
//
// Run it from the repository root:
//     node scripts/build-windows.mjs [output directory]
//
// With no directory it builds into desktop/build/bin and the repository root,
// which is what CI wants. With one, it also copies both files there, which is
// what a delivery wants.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { stampWailsInfo, version } from './stamp.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const stamp = version()

// Pinned first: the installer stamp below edits a tracked file, and a later
// `git describe` would then call a clean commit "-dirty".
process.env.ARROWLOOP_VERSION = stamp
const ldflags = `-X github.com/junkerderprovinz/arrowloop/internal/boot.Version=${stamp}`

function run(command, cwd) {
  const res = spawnSync(command, { cwd, stdio: 'inherit', shell: true })
  if (res.status !== 0) {
    console.error(`failed: ${command}`)
    process.exit(res.status ?? 1)
  }
}

console.log(`building ${stamp}`)

const cli = join(root, 'arrowloop-cli.exe')
run(`go build -ldflags "-s -w ${ldflags}" -o "${cli}" ./cmd/arrowloop`, root)

// The shell's frontend:build copies the interface in and writes the version
// resource. The installer's version lives in the tracked wails.json, so it is
// put back even when the build throws.
const restore = stampWailsInfo()
try {
  run(`wails build -ldflags "${ldflags}" -o ArrowLoop.exe`, join(root, 'desktop'))
} finally {
  restore()
}
const app = join(root, 'desktop', 'build', 'bin', 'ArrowLoop.exe')

const out = process.argv[2]
if (out) {
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  for (const [from, name] of [[cli, 'arrowloop-cli.exe'], [app, 'ArrowLoop.exe']]) {
    try {
      copyFileSync(from, join(dir, name))
      console.log(`delivered ${name}`)
    } catch (e) {
      // A running executable cannot be replaced; the other file still gets
      // through.
      console.error(`could not replace ${name}: ${e.message}`)
    }
  }
}

console.log(`done: ${stamp}`)
