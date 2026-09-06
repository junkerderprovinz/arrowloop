// Builds both Windows executables with the SAME version stamped into both.
//
// The two used to be built by two hand-typed commands, each passing its own
// -ldflags, which is exactly the arrangement where one of them ends up a commit
// behind and nobody notices: the file properties would say one thing and the
// About card another, and the whole point of a stamp is that it can be trusted.
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

import { version } from './stamp.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const stamp = version()
const ldflags = `-X github.com/junkerderprovinz/arrowloop/internal/boot.Version=${stamp}`

function run(command, cwd) {
  const res = spawnSync(command, { cwd, stdio: 'inherit', shell: true })
  if (res.status !== 0) {
    console.error(`failed: ${command}`)
    process.exit(res.status ?? 1)
  }
}

console.log(`building ${stamp}`)

// The command line binary. Stripped, because nothing debugs a released one from
// its symbol table and the download is smaller without them.
const cli = join(root, 'arrowloop-cli.exe')
run(`go build -ldflags "-s -w ${ldflags}" -o "${cli}" ./cmd/arrowloop`, root)

// The desktop shell. Its own frontend:build step copies the interface in and
// writes the version resource, so both happen here without being asked for.
run(`wails build -ldflags "${ldflags}" -o ArrowLoop.exe`, join(root, 'desktop'))
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
      // A file somebody is running cannot be replaced, and that is worth
      // saying rather than failing over: the other one still gets through, and
      // the fix is to close a window rather than to change anything here.
      console.error(`could not replace ${name}: ${e.message}`)
    }
  }
}

console.log(`done: ${stamp}`)
