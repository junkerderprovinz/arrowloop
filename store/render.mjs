// Builds the Play and F-Droid images in fastlane/metadata/android from the
// captures in store/captures/<locale>/: six phone screenshots at 1080x1920
// and the 1024x500 feature graphic. Each capture sits in a drawn phone on the
// dark relief background, under a caption. The first picture has no capture:
// it is a wall of the provider tiles, drawn from the app's own marks.
//
// The captures are plain screenshots of the app in dark mode, 1080x1920, with
// the status bar in demo mode. Name them after the SHOTS below.
//
// `node store/render.mjs readme` builds the README's pictures instead, in
// .github/assets/screenshots: the web interface from store/captures/web/,
// 1440x700 at twice the pixels, in a desktop window and in a browser beside a
// caption in the same style, the Android app as wide as those two, and the
// call for Android testers.
//
// Every page is rendered at twice the size and scaled down in a second page,
// which keeps the text sharp through the phone's tilt.
//
// Deps (global): playwright-core with its Chromium installed.
// Run: node store/render.mjs [readme]

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BRANDS, GLYPHS } from '../web/src/lib/glyphs.data.ts'

const require = createRequire(import.meta.url)
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright-core`)

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const metadata = join(root, 'fastlane', 'metadata', 'android')

const CAPTIONS = {
  'de-DE': {
    sub: 'ArrowLoop für Android',
    tagline: 'Synchronisiere alles überallhin.<br>Über 60 Clouds und Server.',
    everywhere: 'Synchronisiere alles <em>überallhin</em>',
    everywhereSub: 'Zwei-Wege-Sync mit über 60 Clouds und Servern',
    smb: 'Windows-Freigabe',
    s3: 'S3-kompatibel',
    plan: 'Du siehst jeden Pfeil, <em>bevor er fliegt</em>',
    jobs: 'Handy und Cloud, <em>hin und zurück</em>',
    targets: 'Dein Speicher. <em>Nicht unserer.</em>',
    history: 'Jede Datei hat <em>ein Alibi</em>',
    trash: 'Gelöscht? <em>Nur umgezogen.</em>',
  },
  'en-US': {
    sub: 'ArrowLoop for Android',
    tagline: 'Sync it everywhere.<br>Over 60 clouds and servers.',
    everywhere: 'Sync it<br><em>everywhere</em>',
    everywhereSub: 'Two-way sync with over 60 clouds and servers',
    smb: 'Windows share',
    s3: 'S3 compatible',
    plan: 'See every arrow <em>before it flies</em>',
    jobs: 'Phone to cloud <em>and back again</em>',
    targets: 'Your storage. <em>Not ours.</em>',
    history: 'Every file <em>has an alibi</em>',
    trash: 'Deleted? <em>Just moved out.</em>',
  },
}

// The README's wide pictures, in English like the README.
const WIDE = [
  { name: 'desktop', capture: 'plan', frame: 'window', caption: 'See every arrow <em>before it flies</em>', sub: 'ArrowLoop for Windows, macOS and Linux' },
  { name: 'container', capture: 'jobs', frame: 'browser', caption: 'On your server, <em>day and night</em>', sub: 'ArrowLoop in Docker, on Unraid or any other host' },
]

// The order on the store page. `lift` is a card of the capture, in capture
// pixels, drawn floating in front of the phone.
const SHOTS = [
  { name: 'everywhere', wall: true },
  { name: 'plan', lift: { x: 42, y: 425, w: 996, h: 381 } },
  { name: 'jobs' },
  { name: 'targets' },
  { name: 'history' },
  { name: 'trash' },
]

// Height of the status bar in a capture, which the phone redraws with room
// for its rounded corners.
const STATUS_H = 63

// The provider wall, row by row, best known first. Every second row is shifted
// right and the wall fades out to the right, so the lesser names go last.
// `lit` draws a tile in its brand's colour, as under a finger. `key` and `sub`
// name a translated name or second line in CAPTIONS.
const WALL = [
  [{ name: 'Google Drive', mark: 'IconGoogleDrive', lit: true }, { name: 'OneDrive', mark: 'IconOnedrive' }, { name: 'Dropbox', mark: 'IconDropbox' }, { name: 'Linode', mark: 'IconLinode' }],
  [{ name: 'iCloud Drive', mark: 'IconICloud' }, { name: 'Proton Drive', mark: 'IconProtonDrive', lit: true }, { name: 'MEGA', mark: 'IconMega' }, { name: 'Linkbox', mark: 'IconLinkbox' }],
  [{ name: 'Nextcloud', mark: 'IconNextcloud' }, { name: 'SMB', sub: 'smb', mark: 'IconFolder' }, { name: 'SFTP', mark: 'IconServer' }, { name: 'Ceph', mark: 'IconCeph' }],
  [{ name: 'WebDAV', mark: 'IconLink' }, { name: 'Backblaze B2', mark: 'IconBackblaze' }, { name: 'Box', mark: 'IconBox' }, { name: 'Garage', mark: 'IconGarage' }],
  [{ name: 'pCloud', mark: 'IconPcloud' }, { name: 'Cloudflare R2', mark: 'IconCloudflare', lit: true }, { name: 'OpenCloud', mark: 'IconOpencloud' }, { name: 'SeaweedFS', mark: 'IconSeaweedfs' }],
  [{ name: 'ownCloud', mark: 'IconOwncloud' }, { name: 'Google Photos', mark: 'IconGooglePhotos' }, { name: 'Wasabi', mark: 'IconWasabi' }, { name: 'Oracle Cloud', mark: 'IconOracleCloud' }],
  [{ name: 'Koofr', mark: 'IconKoofr' }, { name: 'Seafile', mark: 'IconSeafile' }, { name: 'MinIO', mark: 'IconMinio', lit: true }, { name: 'Storj', mark: 'IconStorj' }],
  [{ name: 'Jottacloud', mark: 'IconJottacloud' }, { name: 'FTP', mark: 'IconTransfer' }, { name: 'Synology C2', mark: 'IconSynology' }, { name: 'Huawei Drive', mark: 'IconHuaweiCloud' }],
  [{ key: 's3', mark: 'IconBuckets' }, { name: 'Hetzner', mark: 'IconHetzner' }, { name: 'Internxt', mark: 'IconInternxt' }, { name: 'Yandex Disk', mark: 'IconYandex' }],
  [{ name: 'IONOS HiDrive', mark: 'IconIonos' }, { name: 'Azure Blob', mark: 'IconAzure' }, { name: 'Mail.ru Cloud', mark: 'IconMailru' }, { name: 'PikPak', mark: 'IconPikpak' }],
  [{ name: 'Google Cloud', mark: 'IconGoogleCloud' }, { name: 'DigitalOcean', mark: 'IconDigitalOcean' }, { name: 'OVHcloud', mark: 'IconOvh' }, { name: 'Zoho WorkDrive', mark: 'IconZoho' }],
  [{ name: 'Filen', mark: 'IconFilen' }, { name: 'IDrive e2', mark: 'IconIdrive' }, { name: 'Scaleway', mark: 'IconScaleway' }, { name: 'Pixeldrain', mark: 'IconPixeldrain' }],
]

async function cached(file, url) {
  const path = join(tmpdir(), `ArrowLoop-${file}`)
  if (!existsSync(path)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${file}: fetch ${res.status}`)
    writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  }
  return readFileSync(path)
}

const dataUrl = (buf, type) => `data:${type};base64,${buf.toString('base64')}`
const bree = dataUrl(await cached('BreeSerif-Regular.ttf', 'https://github.com/google/fonts/raw/main/ofl/breeserif/BreeSerif-Regular.ttf'), 'font/ttf')
const lato = dataUrl(await cached('Lato-Regular.ttf', 'https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf'), 'font/ttf')
// The phone's own face, for the provider tiles.
const roboto = dataUrl(await cached('Roboto.ttf', 'https://github.com/google/fonts/raw/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf'), 'font/ttf')
const logo = dataUrl(readFileSync(join(root, 'docs', 'assets', 'logo.svg')), 'image/svg+xml')

const STYLE = `
@font-face { font-family: "Bree Serif"; src: url(${bree}); }
@font-face { font-family: Lato; src: url(${lato}); }
@font-face { font-family: Roboto; src: url(${roboto}); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { position: relative; overflow: hidden; font-family: Lato, sans-serif; background: #0c0c0b; }
.backdrop, .backdrop * { position: absolute; }
.backdrop { inset: 0; overflow: hidden; }
.wall { inset: 0; background: radial-gradient(55% 60% at 62% 35%, #26231d, #0f0e0c 72%); }
.mark { transform: rotate(-10deg); opacity: .32;
  filter: grayscale(1) brightness(.36) contrast(1.2) drop-shadow(-2px -2px 0 rgba(255,255,255,.16)) drop-shadow(12px 18px 26px rgba(0,0,0,.85)); }
.vignette { inset: 0; box-shadow: inset 0 0 200px rgba(0,0,0,.6); }
h1 { font-family: "Bree Serif", serif; font-weight: 400; color: #f4f4f4; text-wrap: balance; }
h1 em { font-style: normal; color: #FCC419; }
.sub { color: #9d9481; }

.stage { position: absolute; perspective: 2400px; }
.floor { position: absolute; left: 12%; right: 12%; bottom: -4%; height: 8%; border-radius: 50%; background: rgba(0,0,0,.8); filter: blur(30px); }
.phone { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateY(-7deg) rotateX(3deg);
  background: linear-gradient(135deg, #9a9a9a 0%, #4a4a4a 14%, #2c2c2c 45%, #3a3a3a 70%, #6e6e6e 100%);
  box-shadow: -1px 1px 0 #262626, -2px 2px 0 #222, -3px 3px 0 #1e1e1e, -4px 4px 0 #1a1a1a, -5px 5px 0 #161616,
    0 2px 4px rgba(0,0,0,.35), 0 18px 36px rgba(0,0,0,.45), 0 52px 100px rgba(0,0,0,.55); }
.key { position: absolute; right: -4px; width: 5px; border-radius: 0 3px 3px 0; background: linear-gradient(90deg, #2a2a2a, #6a6a6a); }
.glass { position: absolute; background: #050505; box-shadow: inset 0 0 0 1px rgba(255,255,255,.07); }
.screen { position: absolute; overflow: hidden; background: #161616; }
.screen > img { position: absolute; left: 0; top: 0; width: 100%; }
.status { position: absolute; left: 0; right: 0; top: 0; background: #161616; }
.status i { position: absolute; top: 0; height: 100%; background-repeat: no-repeat; }
.cam { position: absolute; left: 50%; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #2d3440, #050505 60%); box-shadow: 0 0 0 2px #0b0b0b; }
.glare { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(118deg, rgba(255,255,255,.09) 0%, rgba(255,255,255,.03) 28%, rgba(255,255,255,0) 42%); }
.lift { position: absolute; overflow: hidden; transform: translateZ(70px); background-repeat: no-repeat;
  box-shadow: 0 0 0 1px #474747, 0 4px 8px rgba(0,0,0,.35), 0 22px 44px rgba(0,0,0,.5), 0 50px 90px rgba(0,0,0,.45); }
`

const backdrop = (w, left, top) =>
  `<div class="backdrop"><div class="wall"></div><img class="mark" src="${logo}" style="width:${w};left:${left};top:${top}"><div class="vignette"></div></div>`

/** A phone showing `capture` with its screen `sw` wide, its top left corner at (x, y). */
function phone(capture, { x, y, sw, lift }) {
  const k = sw / 1080
  const sh = Math.round(1920 * k)
  const rim = Math.max(2, Math.round(sw * 0.01))
  const bezel = Math.round(sw * 0.024)
  const r = Math.round(sw * 0.1)
  const w = sw + 2 * (rim + bezel)
  const h = sh + 2 * (rim + bezel)
  const bar = STATUS_H * k
  // The clock and the icons move inwards by this much, clear of the corners.
  const inset = Math.round(sw * 0.045)
  const bg = `url(${capture})`
  const size = `${sw}px ${sh}px`
  const cam = Math.round(sw * 0.028)

  // The lifted card is drawn a tenth larger and reaches past the phone's left edge.
  const z = k * 1.1
  const floating = lift
    ? `<div class="lift" style="left:${rim + bezel + lift.x * k - lift.w * k * 0.09}px;top:${rim + bezel + lift.y * k}px;width:${lift.w * z}px;height:${lift.h * z}px;border-radius:${40 * z}px;
        background-image:${bg};background-size:${1080 * z}px ${1920 * z}px;background-position:${-lift.x * z}px ${-lift.y * z}px"></div>`
    : ''

  return `<div class="stage" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
  <div class="floor"></div>
  <div class="phone" style="border-radius:${r + rim + bezel}px">
    <i class="key" style="top:${h * 0.18}px;height:${h * 0.07}px"></i>
    <i class="key" style="top:${h * 0.28}px;height:${h * 0.12}px"></i>
    <div class="glass" style="inset:${rim}px;border-radius:${r + bezel}px">
      <div class="screen" style="inset:${bezel}px;border-radius:${r}px">
        <img src="${capture}">
        <div class="status" style="height:${bar}px">
          <i style="left:${inset}px;width:${sw * 0.2}px;background-image:${bg};background-size:${size};background-position:0 0"></i>
          <i style="right:${inset}px;width:${sw * 0.2}px;background-image:${bg};background-size:${size};background-position:${-sw * 0.8}px 0"></i>
        </div>
        <div class="cam" style="top:${(bar - cam) / 2}px;width:${cam}px;height:${cam}px;margin-left:${-cam / 2}px"></div>
        <div class="glare"></div>
      </div>
    </div>
    ${floating}
  </div>
</div>`
}

function screenshot(capture, caption, sub, lift) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}
body { width: 1080px; height: 1920px; }
.copy { position: absolute; left: 88px; right: 88px; top: 110px; display: flex; flex-direction: column; gap: 30px; }
.copy img { width: 92px; }
h1 { font-size: 78px; line-height: 1.12; }
.sub { font-size: 34px; }
</style></head><body>
${backdrop('78%', '-16%', '-5%')}
<div class="copy"><img src="${logo}"><h1>${caption}</h1><p class="sub">${sub}</p></div>
${phone(capture, { x: lift ? 232 : 196, y: 612, sw: 640, lift })}
</body></html>`
}

/**
 * A provider's mark as the phone draws it (`whole` and `Drawn` in
 * mobile/src/glyphs.tsx), in the dark theme. `lit` is the tile's ink and
 * colour while a finger is on it.
 */
function markSvg(name, lit) {
  const brand = BRANDS[name]
  if (!brand) {
    const color = lit ? lit.ink : '#c6c6c6'
    const parts = (g) =>
      g.parts
        .map((p) =>
          p.rect
            ? `<rect x="${p.rect[0]}" y="${p.rect[1]}" width="${p.rect[2]}" height="${p.rect[3]}" rx="${p.rect[4]}" fill="${color}"/>`
            : `<path d="${p.d}" fill="${p.fill === 'none' ? 'none' : color}" fill-rule="evenodd"${p.stroke ? ` stroke="${color}" stroke-width="${p.stroke}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`,
        )
        .join('')
    const glyph = GLYPHS[name]
    return `<svg viewBox="${glyph.box}">${glyph.groups.map((g) => `<g${g.transform ? ` transform="${g.transform}"` : ''}>${parts(g)}</g>`).join('')}</svg>`
  }
  const drawing = lit && brand.lit ? brand.lit : brand
  const rest = brand.fill === null ? undefined : typeof brand.fill === 'string' ? brand.fill : brand.fill.dark
  const fill = lit && (drawing !== brand || (rest && rest !== 'none')) ? lit.ink : rest
  let body = drawing.svg.replace(/\[\[(ink|cut)\|([^\]]*)\]\]/g, (_, role, own) => (!lit ? own : role === 'ink' ? lit.ink : lit.cut))
  for (const [slot, pair] of Object.entries(brand.vars)) body = body.split(`{{${slot}}}`).join(pair.dark)
  return `<svg viewBox="${drawing.box}"${fill ? ` fill="${fill}"` : ''}>${body}</svg>`
}

/** The phone's README button for one provider, at the store picture's scale. */
function tile({ name, key, sub, mark, lit }, text) {
  const own = lit && BRANDS[mark].tile
  const look = own ? `background:${own.color};color:${own.ink}` : ''
  const second = sub ? `<small>${text[sub]}</small>` : ''
  return `<div class="tile" style="${look}">${markSvg(mark, own && { ink: own.ink, cut: own.color })}<div class="name"><b data-fit>${key ? text[key] : name}</b>${second}</div></div>`
}

function wallShot(text) {
  const rows = WALL.map((row) => `<div class="row">${row.map((p) => tile(p, text)).join('')}</div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}
body { width: 1080px; height: 1920px; }
.copy { position: absolute; left: 88px; right: 88px; top: 110px; display: flex; flex-direction: column; gap: 30px; }
.copy img { width: 92px; }
h1 { font-size: 78px; line-height: 1.12; }
.sub { font-size: 34px; }

.wallstage { position: absolute; left: 0; right: 0; top: 590px; bottom: 0; perspective: 2400px; perspective-origin: 0 30%;
  -webkit-mask-image: linear-gradient(to right, #000 72%, transparent 99%); }
.fade { position: absolute; inset: 0; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 4%, #000 80%, transparent 99%); }
.plane { position: absolute; left: 88px; top: 46px; display: flex; flex-direction: column; gap: 23px;
  transform-origin: 0 0; transform: rotateY(-16deg) rotateX(4deg); }
.row { display: flex; gap: 23px; }
.row:nth-child(even) { margin-left: 156px; }
/* mobile/src/ui.tsx's ReadmeButton, 160 by 46.6 there, at 1.8 times. */
.tile { position: relative; flex: none; width: 288px; height: 84px; border-radius: 42px; background: #393939; color: #f4f4f4;
  box-shadow: 0 2px 4px rgba(0,0,0,.3), 0 12px 26px rgba(0,0,0,.45); }
.tile svg { position: absolute; left: 43px; top: 19.5px; width: 58px; height: 45px; }
.tile .name { position: absolute; left: 113px; right: 18px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; white-space: nowrap; }
.tile b { font: 700 25px/1.2 Roboto, sans-serif; }
.tile small { font: 400 20px/1.4 Roboto, sans-serif; }
</style></head><body>
${backdrop('78%', '-16%', '-5%')}
<div class="copy"><img src="${logo}"><h1>${text.everywhere}</h1><p class="sub">${text.everywhereSub}</p></div>
<div class="wallstage"><div class="fade"><div class="plane">${rows}</div></div></div>
</body></html>`
}

function featureGraphic(back, front, tagline) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}
body { width: 1024px; height: 500px; }
.copy { position: absolute; left: 70px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
.copy img { width: 84px; }
.name { font: 400 66px/1 "Bree Serif", serif; color: #f4f4f4; }
.sub { font-size: 25px; line-height: 1.35; }
</style></head><body>
${backdrop('46%', '-9%', '-4%')}
<div class="copy"><img src="${logo}"><div class="name">ArrowLoop</div><p class="sub">${tagline}</p></div>
${phone(back, { x: 590, y: 76, sw: 196 })}
${phone(front, { x: 758, y: 40, sw: 220 })}
</body></html>`
}

const WINDOW_STYLE = `
.win { position: absolute; inset: 0; transform: rotateY(-8deg) rotateX(2deg); border-radius: 14px; overflow: hidden; background: #161616;
  box-shadow: 0 0 0 1px #3c3c3c, 0 2px 4px rgba(0,0,0,.35), 0 18px 36px rgba(0,0,0,.45), 0 52px 100px rgba(0,0,0,.55); }
.win > img { display: block; }
.bar { position: relative; display: flex; align-items: center; background: #242424; color: #d6d6d6; font: 400 17px/1 Lato, sans-serif; }
.bar img { width: 22px; height: 22px; }
.app { height: 44px; gap: 10px; padding-left: 16px; border-bottom: 1px solid #111; }
.ctl { position: absolute; top: 0; width: 46px; height: 44px; }
.ctl::before { content: ""; position: absolute; left: 17px; top: 21px; width: 12px; height: 1.5px; background: #bdbdbd; }
.ctl.min { right: 92px; }
.ctl.max { right: 46px; }
.ctl.max::before { top: 16px; height: 12px; background: none; border: 1.5px solid #bdbdbd; box-sizing: border-box; }
.ctl.close { right: 0; }
.ctl.close::before, .ctl.close::after { content: ""; position: absolute; left: 16px; top: 21px; width: 14px; height: 1.5px; background: #bdbdbd; }
.ctl.close::before { transform: rotate(45deg); }
.ctl.close::after { transform: rotate(-45deg); }
.tabs { height: 42px; padding: 7px 0 0 12px; background: #1c1c1c; align-items: flex-end; }
.tab { display: flex; align-items: center; gap: 10px; height: 35px; padding: 0 70px 0 14px; border-radius: 10px 10px 0 0; background: #2c2c2c; font-size: 15px; }
.tab img { width: 18px; height: 18px; }
.address { height: 46px; gap: 14px; padding: 0 14px; background: #2c2c2c; border-bottom: 1px solid #111; }
.nav { width: 10px; height: 10px; border-left: 2px solid #9a9a9a; border-bottom: 2px solid #9a9a9a; transform: rotate(45deg); margin: 0 4px; }
.nav.fwd { transform: rotate(-135deg); border-color: #5a5a5a; }
.url { flex: 1; height: 32px; border-radius: 16px; background: #1a1a1a; padding-left: 18px; display: flex; align-items: center; font-size: 15px; color: #c9c9c9; }
`

/** The web interface in a desktop window or a browser `w` wide, its top left corner at (x, y). */
function windowed(capture, frame, { x, y, w }) {
  const h = Math.round(700 * (w / 1440))
  const chrome =
    frame === 'browser'
      ? `<div class="bar tabs"><div class="tab"><img src="${logo}"><span>ArrowLoop</span></div></div>
         <div class="bar address"><i class="nav"></i><i class="nav fwd"></i><div class="url">nas.local:8422</div></div>`
      : `<div class="bar app"><img src="${logo}"><span>ArrowLoop</span><i class="ctl min"></i><i class="ctl max"></i><i class="ctl close"></i></div>`
  const bar = frame === 'browser' ? 89 : 45
  return `<div class="stage" style="left:${x}px;top:${y}px;width:${w}px;height:${h + bar}px">
  <div class="floor"></div>
  <div class="win">${chrome}<img src="${capture}" style="width:${w}px;height:${h}px"><div class="glare"></div></div>
</div>`
}

function wideShot(capture, frame, caption, sub) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}${WINDOW_STYLE}
body { width: 1920px; height: 1000px; }
.copy { position: absolute; left: 84px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
.copy img { width: 92px; }
h1 { font-size: 64px; line-height: 1.12; }
.sub { font-size: 28px; line-height: 1.35; }
</style></head><body>
${backdrop('50%', '-9%', '-6%')}
<div class="copy"><img src="${logo}"><h1>${caption}</h1><p class="sub">${sub}</p></div>
${windowed(capture, frame, { x: 600, y: frame === 'browser' ? 148 : 170, w: 1270 })}
</body></html>`
}

/** The README's Android picture, three phones beside the caption, as wide as the other two. */
function androidShot(left, middle, right, lift) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}
body { width: 1920px; height: 1000px; }
.copy { position: absolute; left: 84px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
.copy img { width: 92px; }
h1 { font-size: 64px; line-height: 1.12; }
.sub { font-size: 28px; line-height: 1.35; }
</style></head><body>
${backdrop('50%', '-9%', '-6%')}
<div class="copy"><img src="${logo}"><h1>Phone to cloud <em>and back again</em></h1><p class="sub">ArrowLoop for Android, with the engine on the phone</p></div>
${phone(left, { x: 640, y: 230, sw: 330 })}
${phone(right, { x: 1490, y: 230, sw: 330 })}
${phone(middle, { x: 1040, y: 150, sw: 380, lift })}
</body></html>`
}

/** The README's call for Android testers, two phones beside a button-shaped call. */
function testersShot(back, front) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}
body { width: 1920px; height: 640px; }
.copy { position: absolute; left: 96px; top: 0; bottom: 0; width: 1060px; display: flex; flex-direction: column; justify-content: center; gap: 26px; }
.label { align-self: flex-start; padding: 8px 18px; border-radius: 8px; background: #FCC419; color: #141414; font: 700 22px/1 Lato, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
h1 { font-size: 92px; line-height: 1.05; }
.sub { font-size: 34px; line-height: 1.35; color: #c9bfa9; }
.go { align-self: flex-start; margin-top: 8px; padding: 22px 40px; border-radius: 18px; background: #FCC419; color: #141414; font: 700 34px/1 Lato, sans-serif;
  box-shadow: 0 0 0 6px rgba(252,196,25,.18), 0 18px 40px rgba(0,0,0,.5); }
</style></head><body>
${backdrop('40%', '58%', '-30%')}
<div class="copy">
  <span class="label">Google Play closed test</span>
  <h1>Android testers <em>wanted</em></h1>
  <p class="sub">Keep ArrowLoop installed for 14 days and help it go public.</p>
  <span class="go">Become a tester &rarr;</span>
</div>
${phone(back, { x: 1290, y: 92, sw: 250 })}
${phone(front, { x: 1530, y: 58, sw: 282 })}
</body></html>`
}

/** Renders `html` at twice `width` x `height` and writes it scaled down to `file`. */
async function render(browser, html, width, height, file) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  // A name too long for its tile shrinks, as the phone's adjustsFontSizeToFit does.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-fit]')) {
      const room = el.parentElement.clientWidth
      let size = parseFloat(getComputedStyle(el).fontSize)
      while (el.scrollWidth > room && size > 10) el.style.fontSize = `${--size}px`
    }
  })
  const big = await page.screenshot()
  await page.close()

  const small = await browser.newPage({ viewport: { width, height } })
  await small.setContent(`<body style="margin:0"><img src="${dataUrl(big, 'image/png')}" style="display:block;width:${width}px;height:${height}px">`)
  await small.locator('img').evaluate((img) => img.decode())
  await small.screenshot({ path: file })
  await small.close()
}

async function readme(browser) {
  const out = join(root, '.github', 'assets', 'screenshots')
  mkdirSync(out, { recursive: true })
  for (const { name, capture, frame, caption, sub } of WIDE) {
    const shot = dataUrl(readFileSync(join(here, 'captures', 'web', `${capture}.png`)), 'image/png')
    await render(browser, wideShot(shot, frame, caption, sub), 1920, 1000, join(out, `${name}.png`))
    console.log(`wrote .github/assets/screenshots/${name}.png`)
  }
  const phoneShot = (name) => dataUrl(readFileSync(join(here, 'captures', 'en-US', `${name}.png`)), 'image/png')
  const lift = SHOTS.find((s) => s.name === 'plan').lift
  await render(browser, androidShot(phoneShot('jobs'), phoneShot('plan'), phoneShot('targets'), lift), 1920, 1000, join(out, 'android.png'))
  console.log('wrote .github/assets/screenshots/android.png')
  await render(browser, testersShot(phoneShot('jobs'), phoneShot('plan')), 1920, 640, join(out, 'testers.png'))
  console.log('wrote .github/assets/screenshots/testers.png')
}

async function store(browser) {
  for (const [locale, text] of Object.entries(CAPTIONS)) {
    const capture = (name) => dataUrl(readFileSync(join(here, 'captures', locale, `${name}.png`)), 'image/png')
    const images = join(metadata, locale, 'images')
    for (const [i, { name, lift, wall }] of SHOTS.entries()) {
      const html = wall ? wallShot(text) : screenshot(capture(name), text[name], text.sub, lift)
      await render(browser, html, 1080, 1920, join(images, 'phoneScreenshots', `${i + 1}.png`))
      console.log(`wrote ${locale}/images/phoneScreenshots/${i + 1}.png`)
    }
    await render(browser, featureGraphic(capture('jobs'), capture('plan'), text.tagline), 1024, 500, join(images, 'featureGraphic.png'))
    console.log(`wrote ${locale}/images/featureGraphic.png`)
  }
}

const browser = await chromium.launch()
try {
  await (process.argv[2] === 'readme' ? readme : store)(browser)
} finally {
  await browser.close()
}
