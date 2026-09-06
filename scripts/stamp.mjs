// What this build IS, worked out once and used everywhere it has to appear.
//
// Three places have to agree, and until now only one of them said anything:
// the Windows file properties, the About card in the interface, and the line
// the command line prints on startup. Somebody looking at an executable on
// their desktop and asking "is this the one from an hour ago" could open it
// and read the About card, which is a poor answer for a file sitting in a
// folder next to three others.
//
// The version resource is written into desktop/build/windows/info.json, which
// is a GENERATED file (it is in .gitignore, and Wails writes a default one when
// it is missing). That is what makes stamping it safe: nothing tracked is
// modified by a build, so a build never leaves the repository dirty and a
// crashed build never leaves a half-written version behind in something
// somebody might commit.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** Runs git and returns its answer, or an empty string when it has none. */
function git(...args) {
  try {
    // stderr is swallowed rather than inherited: `git describe` on a
    // repository with no tags writes "fatal: No names found" and exits
    // non-zero, which is an ANSWER here (there is no tag) and not a failure
    // worth printing in the middle of every build.
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // A source archive with no .git is a perfectly reasonable thing to build
    // from; it simply cannot say which commit it came from.
    return ''
  }
}

/**
 * The version this build carries.
 *
 * A tag when the commit has one, because that is the name people use for a
 * release. The commit otherwise, because between releases there is no other
 * honest answer: a build that called itself 0.1.0 for the six weeks after
 * 0.1.0 was tagged would be telling somebody their month-old file is current.
 *
 * "-dirty" survives into the string on purpose. A build made from an edited
 * tree is not the commit it names, and the one moment that matters is the one
 * where somebody is trying to work out why a fix is not in the file.
 */
export function version() {
  // Decided ONCE per build and carried in the environment from there on.
  //
  // Without this the answer is recomputed at every step, and one step in the
  // Windows build writes a tracked file on its way past: `git describe --dirty`
  // then starts saying "-dirty" halfway through a build of a perfectly clean
  // commit, so the release bundle would name a state that never existed.
  if (process.env.ARROWLOOP_VERSION) return process.env.ARROWLOOP_VERSION
  return git('describe', '--tags', '--always', '--dirty') || 'dev'
}

/**
 * The numeric version Windows insists on for its fixed version field.
 *
 * That field is four 16-bit numbers and cannot hold a commit hash, so it gets
 * the release version and nothing else. It is deliberately NOT the thing to
 * read to identify a build; it is the thing that keeps Windows happy while the
 * string field beside it carries the real answer.
 *
 * The fourth number is how many commits are in the history, which gives a
 * value that always moves forward even while the first three stand still
 * between releases.
 */
export function numericVersion() {
  const tag = git('describe', '--tags', '--abbrev=0') || 'v0.0.0'
  const parts = tag.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const [major = 0, minor = 0, patch = 0] = parts
  const count = parseInt(git('rev-list', '--count', 'HEAD'), 10) || 0
  // Windows takes each field modulo 65536; a project with more commits than
  // that would silently wrap, so it is clamped rather than left to wrap.
  return `${major}.${minor}.${patch}.${Math.min(count, 65535)}`
}

/**
 * Writes the Windows version resource Wails compiles into the executable.
 *
 * Called from the same script that copies the interface in, so it happens on
 * every build for the same reason: a step that only runs when somebody
 * remembers it is a step that is one day forgotten, and the whole point of a
 * version stamp is that it is never absent.
 */
export function writeWindowsVersion() {
  const dir = join(root, 'desktop', 'build', 'windows')
  mkdirSync(dir, { recursive: true })
  const info = {
    // Both numeric fields, not just the file one: the properties dialog shows
    // them under two separate headings, and one filled beside one empty reads
    // as a build that half-forgot to say what it is.
    fixed: { file_version: numericVersion(), product_version: numericVersion() },
    info: {
      // 0409 is US English, and it has to be a real language: Wails ships its
      // template with 0000, which parses as "language neutral", and Windows
      // does not look there. The strings then sit in the executable, correctly
      // encoded and completely invisible, which is how this went unnoticed
      // until somebody opened the properties dialog and found every field
      // blank. Checked by reading the built file back, not by trusting the
      // template.
      '0409': {
        ProductVersion: version(),
        CompanyName: 'junkerderprovinz',
        FileDescription: 'ArrowLoop',
        LegalCopyright: '',
        ProductName: 'ArrowLoop',
        // The one line somebody reads in the properties dialog to answer the
        // only question they came there with.
        Comments: `Two-way file synchronisation. Build ${version()}.`,
        // Wails does not use this field itself; it is here because the
        // properties dialog shows it and "which commit" is what the string
        // above answers only if somebody knows to read it as one.
        InternalName: version(),
      },
    },
  }
  writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, '\t') + '\n')
  return info
}

/**
 * The installer's own version, which does NOT come from the file above.
 *
 * Wails writes the executable's version resource from build/windows/info.json,
 * and the NSIS installer's from wails.json's `info.productVersion`, and there
 * is no setting that covers both. Left alone, the installer ships Wails' own
 * default of "1.0.0" and shows it in Apps and features: a number that has never
 * belonged to any build, presented as this one's. That is precisely the lie
 * that cost jdp an afternoon of looking at a stale window, so it is not a
 * cosmetic gap.
 *
 * NSIS wants three numbers and refuses a commit hash, so an untagged build gets
 * 0.0.0 rather than something invented. The executable inside still carries the
 * exact commit; this field is the coarse label on the box.
 *
 * Returns a function that puts the file back, because wails.json is TRACKED.
 * The caller must run it, and must run it even when the build fails, or the
 * next `git status` shows a change nobody made on purpose.
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
  // Also on the way out, and that is not belt and braces. The caller's own
  // failure path calls process.exit, which does NOT run a finally block, so a
  // build that failed would leave the edited file behind for somebody to find
  // in their next `git status` and wonder about.
  //
  // Switched off when the stamp has to OUTLIVE this process, which is the
  // workflow's case: it stamps in one step, builds in the next and restores in
  // a third, so a handler here would undo the edit the instant this script
  // finished and the installer would carry 1.0.0 again with nothing to show
  // for the step.
  if (restoreOnExit) process.on('exit', restore)
  return restore
}

// Run directly, this hands the same answer to a build that is not a Node
// script: `node scripts/stamp.mjs` prints it, and `--github-env` appends it to
// the workflow environment.
//
// It writes that file itself rather than printing for a shell to redirect,
// because the desktop matrix runs on three operating systems and the redirect
// would have to be written twice, once for pwsh and once for sh. Two spellings
// of one line is where one of them rots.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  // Deliberately without the exit handler: this stamp has to survive until a
  // later step in the same job puts the file back.
  if (process.argv.includes('--stamp-installer')) {
    stampWailsInfo({ restoreOnExit: false })
  }
  const stamp = version()
  if (process.argv.includes('--github-env') && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `ARROWLOOP_VERSION=${stamp}\n`)
  }
  console.log(stamp)
}
