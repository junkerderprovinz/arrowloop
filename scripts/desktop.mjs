// Builds the desktop app for the platform it runs on, the way CI does.
//
//     node scripts/desktop.mjs [--arch amd64|arm64] [--installer] [--updatetest]
//
// Windows gets ArrowLoop.exe, macOS ArrowLoop.app holding one binary for both
// architectures, and Linux the bare binary, all in desktop/build/bin. With
// --installer, Windows and Linux also get their installer in
// desktop/build/installer, built from desktop/installer.
//
// --updatetest builds with the updatetest tag (desktop/updatetest.go). Its
// installer puts "ArrowLoop Test" beside a real installation, so the updates
// can be tried against a local stand-in for GitHub.
//
// The interface is built first and embedded from web/dist, like the server
// build. Wails' generated files (manifest, version resource, Info.plist, the
// icons) are written into desktop/build on every run and ignored by git, so a
// build leaves the tree as it found it.

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installerVersion, version, writeWindowsVersion } from './stamp.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const desktop = join(root, 'desktop')
const bin = join(desktop, 'build', 'bin')

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const hostArch = process.arch === 'arm64' ? 'arm64' : 'amd64'
const arch = option('--arch') ?? hostArch
const installer = args.includes('--installer')
const updatetest = args.includes('--updatetest')
const tags = (extra = '') => (updatetest ? 'production,updatetest' : 'production') + extra

// Pinned for every step, the Go build and the installer alike.
const stamp = version()
process.env.ARROWLOOP_VERSION = stamp

function run(command, commandArgs, { cwd = desktop, env = {} } = {}) {
  const res = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
  if (res.status !== 0) {
    console.error(`failed: ${command} ${commandArgs.join(' ')}`)
    process.exit(res.status ?? 1)
  }
}

function goBuild(out, { goos, goarch, cgo, tags, ldflags = '', env = {} }) {
  run('go', [
    'build', '-tags', tags, '-trimpath', '-buildvcs=false',
    '-ldflags', `-s -w ${ldflags} -X github.com/junkerderprovinz/arrowloop/internal/boot.Version=${stamp}`,
    '-o', out, '.',
  ], { env: { GOOS: goos, GOARCH: goarch, CGO_ENABLED: cgo, ...env } })
}

// buildInstaller builds desktop/installer around the program at exe, into
// desktop/build/installer so desktop/build/bin stays the program alone.
function buildInstaller(exe, name, { goos, cgo, tags, ldflags = '' }) {
  const payload = join(desktop, 'installer', 'payload')
  rmSync(payload, { recursive: true, force: true })
  mkdirSync(payload, { recursive: true })
  cpSync(exe, join(payload, basename(exe)))
  const vars = [`-X main.version=${installerVersion()}`]
  if (updatetest) vars.push("-X 'main.name=ArrowLoop Test'", '-X main.id=com.junkerderprovinz.arrowloop.test')
  try {
    run('go', [
      'build', '-tags', tags, '-trimpath', '-buildvcs=false',
      '-ldflags', `-s -w ${ldflags} ${vars.join(' ')}`,
      '-o', join(desktop, 'build', 'installer', name), '.',
    ], { cwd: join(desktop, 'installer'), env: { GOOS: goos, GOARCH: arch, CGO_ENABLED: cgo } })
  } finally {
    rmSync(payload, { recursive: true, force: true })
  }
}

console.log(`building ArrowLoop ${stamp}`)

// One fixed string through a shell: Node refuses to spawn npm's .cmd without a
// shell, and deprecates an argument array with one (DEP0190).
const ui = spawnSync('npm run build', { cwd: join(root, 'web'), stdio: 'inherit', shell: true })
if (ui.status !== 0) {
  console.error('the interface did not build, so the app would embed a stale copy')
  process.exit(ui.status ?? 1)
}

rmSync(bin, { recursive: true, force: true })
rmSync(join(desktop, 'build', 'installer'), { recursive: true, force: true })
mkdirSync(bin, { recursive: true })

run('wails3', [
  'update', 'build-assets', '-silent',
  '-name', 'ArrowLoop', '-binaryname', 'ArrowLoop',
  '-config', 'build/config.yml', '-dir', 'build',
  '-productversion', installerVersion(),
])
run('wails3', [
  'generate', 'icons', '-input', 'build/appicon.png',
  '-windowsfilename', 'build/windows/icon.ico', '-macfilename', 'build/darwin/icons.icns',
])

if (process.platform === 'win32') {
  // After Wails' own, which it writes under a language Windows does not read.
  writeWindowsVersion()
  const syso = join(desktop, `wails_windows_${arch}.syso`)
  run('wails3', [
    'generate', 'syso', '-arch', arch, '-icon', 'build/windows/icon.ico',
    '-manifest', 'build/windows/wails.exe.manifest', '-info', 'build/windows/info.json', '-out', syso,
  ])
  const exe = join(bin, 'ArrowLoop.exe')
  try {
    goBuild(exe, { goos: 'windows', goarch: arch, cgo: '0', tags: tags(), ldflags: '-H windowsgui' })
  } finally {
    // Go links every .syso in the package, and one left behind would end up in
    // the next build for the other architecture.
    rmSync(syso, { force: true })
  }

  if (installer) {
    const installerSyso = join(desktop, 'installer', `installer_windows_${arch}.syso`)
    run('wails3', [
      'generate', 'syso', '-arch', arch, '-icon', 'build/windows/icon.ico',
      '-manifest', 'installer/installer.manifest', '-info', 'build/windows/info.json', '-out', installerSyso,
    ])
    try {
      buildInstaller(exe, `ArrowLoop-${arch}-installer.exe`, { goos: 'windows', cgo: '0', tags: '', ldflags: '-H windowsgui' })
    } finally {
      rmSync(installerSyso, { force: true })
    }
  }
} else if (process.platform === 'darwin') {
  // Both architectures in one binary, so one download serves every Mac. The
  // deployment target matches what Wails' own template builds for.
  const mac = { MACOSX_DEPLOYMENT_TARGET: '12.0', CGO_CFLAGS: '-mmacosx-version-min=12.0', CGO_LDFLAGS: '-mmacosx-version-min=12.0' }
  for (const a of ['amd64', 'arm64']) {
    goBuild(join(bin, `ArrowLoop-${a}`), { goos: 'darwin', goarch: a, cgo: '1', tags: tags(), env: mac })
  }
  const app = join(bin, 'ArrowLoop.app', 'Contents')
  mkdirSync(join(app, 'MacOS'), { recursive: true })
  mkdirSync(join(app, 'Resources'), { recursive: true })
  mkdirSync(join(app, 'Library', 'Sounds'), { recursive: true })
  run('lipo', ['-create', '-output', join(app, 'MacOS', 'ArrowLoop'), join(bin, 'ArrowLoop-amd64'), join(bin, 'ArrowLoop-arm64')])
  rmSync(join(bin, 'ArrowLoop-amd64'))
  rmSync(join(bin, 'ArrowLoop-arm64'))
  cpSync(join(desktop, 'build', 'darwin', 'icons.icns'), join(app, 'Resources', 'icons.icns'))
  cpSync(join(desktop, 'build', 'darwin', 'Info.plist'), join(app, 'Info.plist'))
  cpSync(join(desktop, 'build', 'sounds', 'ArrowLoop.wav'), join(app, 'Library', 'Sounds', 'ArrowLoop.wav'))
  // An ad-hoc signature over the whole bundle, as Wails' own template does:
  // Apple Silicon refuses to start code that carries none.
  run('codesign', ['--force', '--deep', '--sign', '-', join(bin, 'ArrowLoop.app')])
} else {
  // GTK 3 and WebKitGTK 4.1, which every current distribution ships and which
  // the builds before this one already needed.
  goBuild(join(bin, 'ArrowLoop'), { goos: 'linux', goarch: arch, cgo: '1', tags: tags(',gtk3') })
  if (installer) {
    buildInstaller(join(bin, 'ArrowLoop'), `ArrowLoop-${arch}-installer`, { goos: 'linux', cgo: '1', tags: 'gtk3' })
  }
}

console.log(`done: ${stamp}`)
