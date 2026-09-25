import { useState } from 'react'

import { QRCode } from '../components/QRCode'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { AppTile, BrandMark } from '../lib/glimstone/AppTile'
import { ANDROID_SVG, APPLE_SVG, DOCKER_SVG, LINUX_SVG, PLAY_SVG, UNRAID_SVG, WINDOWS_SVG, ZIP_SVG } from '../lib/appMarks'
import { followExternal, openExternal } from '../lib/external'
import { useT } from '../lib/i18n'

const REPO = 'https://github.com/junkerderprovinz/arrowloop'

// Every download names a file of the newest published release, so the page
// never needs to know which version that is.
const RELEASE = `${REPO}/releases/latest/download`
const APK = `${RELEASE}/arrowloop-android-arm64.apk`

// Empty until the listing is live; the tile then says it is coming.
const PLAY_STORE = ''
const UNRAID_CA = ''

const DOCKER_RUN =
  'docker run -d --name arrowloop -p 8422:8422 -v /path/to/config:/config -v /path/to/data:/data junkerderprovinz/arrowloop:latest'

const DESKTOP = [
  { key: 'apps.windows', file: 'arrowloop-windows-amd64-installer.exe', mark: WINDOWS_SVG, tint: 'glim-windows-mark' },
  { key: 'apps.windowsArm', file: 'arrowloop-windows-arm64-installer.exe', mark: WINDOWS_SVG, tint: 'glim-windows-mark' },
  { key: 'apps.macos', file: 'arrowloop-macos-universal.dmg', mark: APPLE_SVG, tint: '' },
  { key: 'apps.linux', file: 'arrowloop-linux-amd64', mark: LINUX_SVG, tint: '' },
] as const

/**
 * Where to get ArrowLoop outside this page. The phone app is offered
 * everywhere; the second card offers the forms this one is not, so the
 * desktop app offers the server installs and a server offers the desktop app.
 */
export function Apps({ version, desktop }: { version: string; desktop: boolean }) {
  return (
    <div className="flex flex-col gap-10">
      <PhoneCard version={version} />
      {desktop ? <ServerCard version={version} /> : <DesktopCard />}
    </div>
  )
}

function PhoneCard({ version }: { version: string }) {
  const { t } = useT()
  const [qr, setQr] = useState(false)
  return (
    <Card title={t('apps.phoneTitle')} hint={t('apps.phoneHint')} hueIndex={0}>
      <ReleaseVersion version={version} />
      <div className="flex flex-wrap items-center gap-3">
        <AppTile soonLabel={t('apps.soon')} name={t('apps.playStore')} logo={<BrandMark svg={PLAY_SVG} />} href={PLAY_STORE} onLinkClick={followExternal} />
        {/* The page is usually open on a computer, and the file is wanted on
            the phone, so the tile can turn into a code to scan. */}
        <AppTile
          soonLabel={t('apps.soon')}
          name={t('apps.apk')}
          logo={<BrandMark svg={ANDROID_SVG} className="glim-android-mark" />}
          href={APK}
          onLinkClick={followExternal}
          face={
            qr ? (
              <span className="flex h-full w-full items-center justify-center rounded-control bg-white p-2">
                <QRCode value={APK} size={96} />
              </span>
            ) : undefined
          }
        />
        <div className="flex flex-col gap-2">
          <Button label={t('apps.download')} labelKey="apps.download" onClick={() => openExternal(APK)} />
          <Button label={t('apps.qr')} labelKey="apps.qr" onClick={() => setQr((on) => !on)} />
        </div>
      </div>
    </Card>
  )
}

function DesktopCard() {
  const { t } = useT()
  return (
    <Card title={t('apps.desktopTitle')} hint={t('apps.desktopHint')} hueIndex={1}>
      <div className="flex flex-wrap gap-3">
        {DESKTOP.map((d) => (
          <AppTile soonLabel={t('apps.soon')} key={d.file} href={`${RELEASE}/${d.file}`} onLinkClick={followExternal} name={t(d.key)} logo={<BrandMark svg={d.mark} className={d.tint} />} />
        ))}
      </div>
    </Card>
  )
}

function ServerCard({ version }: { version: string }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  // The source of this very version where it has a tag, the newest otherwise.
  const zip = /^v\d+\.\d+\.\d+$/.test(version)
    ? `${REPO}/archive/refs/tags/${version}.zip`
    : `${REPO}/archive/refs/heads/main.zip`
  return (
    <Card title={t('apps.serverTitle')} hint={t('apps.serverHint')} hueIndex={1}>
      <div className="flex flex-wrap gap-3">
        <AppTile soonLabel={t('apps.soon')} name={t('apps.unraid')} logo={<BrandMark svg={UNRAID_SVG} className="glim-unraid-mark" />} href={UNRAID_CA} onLinkClick={followExternal} />
        <AppTile
          soonLabel={t('apps.soon')}
          name={copied ? t('apps.copied') : t('apps.docker')}
          logo={<BrandMark svg={DOCKER_SVG} className="glim-docker-mark" />}
          hint={t('apps.dockerHint') + ' ' + DOCKER_RUN}
          onClick={() => {
            void navigator.clipboard?.writeText(DOCKER_RUN).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            })
          }}
        />
        <AppTile soonLabel={t('apps.soon')} name={t('apps.zip')} logo={<BrandMark svg={ZIP_SVG} />} href={zip} onLinkClick={followExternal} />
      </div>
    </Card>
  )
}

/** The version the tiles give, linked to its release where it is one. */
function ReleaseVersion({ version }: { version: string }) {
  const plain = /^v\d+\.\d+\.\d+$/.test(version)
  const cls = 'glim-num absolute end-5 top-3 text-[11px] text-carbon-textMuted'
  if (!plain) return <span className={cls}>{version}</span>
  return (
    <a
      href={`${REPO}/releases/tag/${version}`}
      target="_blank"
      rel="noreferrer noopener"
      onClick={followExternal}
      className={`${cls} no-underline hover:text-carbon-text`}
    >
      {version}
    </a>
  )
}
