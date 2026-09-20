// The version of this build, worked out once for the Windows file properties,
// the About card and the startup line to agree on.
//
// The version resource goes into desktop/build/windows/info.json, which is
// generated and ignored by git, so stamping it leaves the tree clean.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** Runs git and returns its answer, or an empty string when it has none. */
function git(...args) {
  try {
    // `git describe` without a tag prints "fatal: No names found", which is an
    // answer here rather than a failure.
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // A source archive has no .git.
    return ''
  }
}

/**
 * The version this build carries: the tag when the commit has one, the commit
 * otherwise, and "-dirty" for a build from an edited tree.
 */
export function version() {
  // Decided once per build, since a later step edits a tracked file and would
  // make a clean commit look dirty.
  if (process.env.ARROWLOOP_VERSION) return process.env.ARROWLOOP_VERSION
  return git('describe', '--tags', '--always', '--dirty') || 'dev'
}

/**
 * The four 16-bit numbers of Windows' fixed version field, which cannot hold a
 * commit hash; the string field beside it identifies the build. The fourth
 * number is the commit count, so it moves forward between releases.
 */
export function numericVersion() {
  const tag = git('describe', '--tags', '--abbrev=0') || 'v0.0.0'
  const parts = tag.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const [major = 0, minor = 0, patch = 0] = parts
  const count = parseInt(git('rev-list', '--count', 'HEAD'), 10) || 0
  // Clamped, since Windows would take the field modulo 65536.
  return `${major}.${minor}.${patch}.${Math.min(count, 65535)}`
}

/**
 * Writes the Windows version resource Wails compiles into the executable. It
 * runs from desktop-ui.mjs, so every build gets it.
 */
export function writeWindowsVersion() {
  const dir = join(root, 'desktop', 'build', 'windows')
  mkdirSync(dir, { recursive: true })
  const info = {
    // The properties dialog shows both numeric fields.
    fixed: { file_version: numericVersion(), product_version: numericVersion() },
    info: {
      // A real language: Windows does not read the strings under Wails'
      // template default 0000, and the properties dialog shows them blank.
      '0409': {
        ProductVersion: version(),
        CompanyName: 'junkerderprovinz',
        FileDescription: 'ArrowLoop',
        LegalCopyright: '',
        ProductName: 'ArrowLoop',
        Comments: `Two-way file synchronisation. Build ${version()}.`,
        InternalName: version(),
      },
    },
  }
  writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, '\t') + '\n')
  return info
}

/**
 * Stamps the NSIS installer's version, which Wails reads from wails.json's
 * `info.productVersion` and would otherwise leave at its default "1.0.0". NSIS
 * takes three numbers only, so an untagged build gets 0.0.0; the executable
 * inside still names the exact commit.
 *
 * wails.json is tracked, so this returns a function that puts it back, which
 * the caller runs even when the build fails.
 */
export function stampWailsInfo({ restoreOnExit = true } = {}) {
  const path = join(root, 'desktop', 'wails.json')
  const before = readFileSync(path, 'utf8')
  const config = JSON.parse(before)
  const tag = (git('describe', '--tags', '--abbrev=0') || '').replace(/^v/, '')
  config.info = { ...config.info, productVersion: /^\d+\.\d+\.\d+$/.test(tag) ? tag : '0.0.0' }
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')

  let done = false
  const restore = () => {
    if (done) return
    done = true
    writeFileSync(path, before)
  }
  // The caller's failure path calls process.exit, which skips a finally block.
  // The workflow switches this off, because it stamps, builds and restores in
  // separate steps.
  if (restoreOnExit) process.on('exit', restore)
  return restore
}

// Run directly, it prints the version, and `--github-env` appends it to the
// workflow environment itself, so the desktop matrix needs no separate redirect
// for pwsh and sh.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  // A later step in the same job puts the file back.
  if (process.argv.includes('--stamp-installer')) {
    stampWailsInfo({ restoreOnExit: false })
  }
  const stamp = version()
  if (process.argv.includes('--github-env') && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `ARROWLOOP_VERSION=${stamp}\n`)
  }
  console.log(stamp)
}
