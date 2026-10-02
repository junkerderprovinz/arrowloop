// Where ArrowLoop's other forms come from, shared by the web's Apps page and
// the phone's cards so the two cannot drift apart.

const REPO = 'https://github.com/junkerderprovinz/arrowloop'

/**
 * Files of the newest published release, so nothing here needs to know which
 * version that is.
 */
export const RELEASE = `${REPO}/releases/latest/download`

export const DOWNLOADS = {
  windows: `${RELEASE}/arrowloop-windows-amd64-installer.exe`,
  windowsArm: `${RELEASE}/arrowloop-windows-arm64-installer.exe`,
  macos: `${RELEASE}/arrowloop-macos-universal.dmg`,
  linux: `${RELEASE}/arrowloop-linux-amd64`,
  linuxArm: `${RELEASE}/arrowloop-linux-arm64`,
  apk: `${RELEASE}/arrowloop-android-arm64.apk`,
}

export const DOCKER_RUN =
  'docker run -d --name arrowloop -p 8422:8422 -v /path/to/config:/config -v /path/to/data:/data junkerderprovinz/arrowloop:latest'

/** The source of this very version where it has a tag, the newest otherwise. */
export function sourceZip(version: string): string {
  return /^v\d+\.\d+\.\d+$/.test(version)
    ? `${REPO}/archive/refs/tags/${version}.zip`
    : `${REPO}/archive/refs/heads/main.zip`
}
