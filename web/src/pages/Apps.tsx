import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'

import { QRCode } from '../components/QRCode'
import { Stack } from '../components/Shell'
import { Card } from '../lib/glimstone/Card'
import { BrandMark, ReadmeButton } from '../lib/glimstone/ReadmeButton'
import { ANDROID_SVG, APPLE_SVG, DOCKER_SVG, LINUX_SVG, PLAY_SVG, UNRAID_SVG, WINDOWS_SVG, ZIP_SVG } from '../lib/appMarks'
import { followExternal } from '../lib/external'
import { useT } from '../lib/i18n'

const REPO = 'https://github.com/junkerderprovinz/arrowloop'

// Every download names a file of the newest published release, so the page
// never needs to know which version that is.
const RELEASE = `${REPO}/releases/latest/download`
const APK = `${RELEASE}/arrowloop-android-arm64.apk`

// Empty until the listing is live; the button then says it is coming.
const PLAY_STORE = ''
const UNRAID_CA = ''

const DOCKER_RUN =
  'docker run -d --name arrowloop -p 8422:8422 -v /path/to/config:/config -v /path/to/data:/data junkerderprovinz/arrowloop:latest'

/**
 * Where to get ArrowLoop outside this page. The phone app is offered
 * everywhere; the second card offers the forms this one is not, so the
 * desktop app offers the server installs and a server offers the desktop app.
 */
export function Apps({ version, desktop }: { version: string; desktop: boolean }) {
  return (
    <Stack>
      <PhoneCard version={version} />
      {desktop ? <ServerCard version={version} /> : <DesktopCard />}
    </Stack>
  )
}

function PhoneCard({ version }: { version: string }) {
  const { t } = useT()
  return (
    <Card title={t('apps.phoneTitle')} hint={t('apps.phoneHint')} hueIndex={0}>
      <ReleaseVersion version={version} />
      <div className="glim-readme-btn-rows">
        <ReadmeButton
          brand="play"
          parts={[{ name: t('apps.playStore'), href: PLAY_STORE }]}
          mark={<BrandMark svg={PLAY_SVG} />}
          soonLabel={t('apps.soon')}
          onLinkClick={followExternal}
        />
        <ApkButton />
      </div>
    </Card>
  )
}

/**
 * The APK, and its QR code as a segment. The page is usually open on a
 * computer and the file is wanted on the phone, but a code cannot be scanned
 * inside a button this height, so the segment opens it in a window over the
 * button.
 */
function ApkButton() {
  const { t } = useT()
  const [qr, setQr] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setQr(false), [])
  return (
    <div ref={box} className="inline-flex">
      <ReadmeButton
        brand="android"
        parts={[
          { name: t('apps.android'), sub: t('apps.apk'), href: APK },
          { name: t('apps.qr'), sub: t('apps.apk'), onClick: () => setQr((open) => !open) },
        ]}
        mark={<BrandMark svg={ANDROID_SVG} />}
        markClass="glim-android-mark"
        onLinkClick={followExternal}
      />
      {qr && <QrWindow anchor={box} value={APK} label={t('apps.qr')} onClose={close} />}
    </div>
  )
}

/**
 * The code in a small window of its own, drawn into the body because the
 * button's unit clips everything inside its edge. It stands above the button
 * where there is room and below it where there is not. Black on white in both
 * themes, since many scanners refuse an inverted code.
 */
function QrWindow({
  anchor,
  value,
  label,
  onClose,
}: {
  anchor: RefObject<HTMLDivElement | null>
  value: string
  label: string
  onClose: () => void
}) {
  const win = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect()
    const own = win.current
    if (!box || !own) return
    const margin = 8
    const { offsetWidth: width, offsetHeight: height } = own
    const above = box.top - margin - height >= margin
    const left = Math.max(margin, Math.min(window.innerWidth - margin - width, box.right - width))
    setAt({ left, top: above ? box.top - margin - height : box.bottom + margin })
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // A press on the segment is left to its own click, which closes the window.
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (win.current?.contains(target) || anchor.current?.contains(target)) return
      onClose()
    }
    // A scroll or a resize carries the button away from the window.
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={win}
      role="dialog"
      aria-label={label}
      className="glim-fade fixed z-50 rounded-card bg-white p-3"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        visibility: at ? 'visible' : 'hidden',
        boxShadow: 'var(--elevation)',
      }}
    >
      <QRCode value={value} size={168} />
    </div>,
    document.body,
  )
}

function DesktopCard() {
  const { t } = useT()
  return (
    <Card title={t('apps.desktopTitle')} hint={t('apps.desktopHint')} hueIndex={1}>
      <div className="glim-readme-btn-rows">
        <ReadmeButton
          brand="windows"
          parts={[
            { name: t('apps.windows'), sub: 'x64', href: `${RELEASE}/arrowloop-windows-amd64-installer.exe` },
            { name: 'ARM64', sub: t('apps.windows'), href: `${RELEASE}/arrowloop-windows-arm64-installer.exe` },
          ]}
          mark={<BrandMark svg={WINDOWS_SVG} />}
          markClass="glim-windows-mark"
          onLinkClick={followExternal}
        />
        <ReadmeButton
          brand="apple"
          parts={[{ name: t('apps.macos'), sub: 'Universal', href: `${RELEASE}/arrowloop-macos-universal.dmg` }]}
          mark={<BrandMark svg={APPLE_SVG} />}
          onLinkClick={followExternal}
        />
        <ReadmeButton
          brand="linux"
          parts={[{ name: t('apps.linux'), sub: 'x64', href: `${RELEASE}/arrowloop-linux-amd64` }]}
          mark={<BrandMark svg={LINUX_SVG} />}
          onLinkClick={followExternal}
        />
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
      <div className="glim-readme-btn-rows">
        <ReadmeButton
          brand="unraid"
          parts={[{ name: t('apps.unraid'), sub: t('apps.unraidSub'), href: UNRAID_CA }]}
          mark={<BrandMark svg={UNRAID_SVG} />}
          markClass="glim-unraid-mark"
          soonLabel={t('apps.soon')}
          onLinkClick={followExternal}
        />
        <ReadmeButton
          brand="docker"
          parts={[
            {
              name: t('apps.docker'),
              sub: copied ? t('apps.copied') : t('apps.dockerSub'),
              onClick: () => {
                void navigator.clipboard?.writeText(DOCKER_RUN).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1800)
                })
              },
            },
          ]}
          mark={<BrandMark svg={DOCKER_SVG} />}
          markClass="glim-docker-mark"
          hint={t('apps.dockerHint') + ' ' + DOCKER_RUN}
          note={copied}
        />
        <ReadmeButton
          brand="zip"
          parts={[{ name: t('apps.source'), sub: t('apps.zipSub'), href: zip }]}
          mark={<BrandMark svg={ZIP_SVG} />}
          onLinkClick={followExternal}
        />
      </div>
    </Card>
  )
}

/** The version the buttons give, linked to its release where it is one. */
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
