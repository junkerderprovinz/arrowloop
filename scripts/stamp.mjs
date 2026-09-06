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
import { mkdirSync, writeFileSync } from 'node:fs'
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
