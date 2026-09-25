/**
 * Generates every ArrowLoop image from one master, icon.svg, embedded verbatim.
 *
 * Outputs, all in this folder:
 *   icon.png             : CA icon, 512, transparent
 *   banner.png/.svg      : white 1600x500, logo, name and claim   [README light]
 *   banner-dark.png/.svg : #0d1117 1600x500, same                  [README dark]
 *   banner-logo.png/.svg : white 1600x500, logo only              [support thread]
 *   favicon.png          : 256, transparent, for the web UI
 *   appicon.png          : 1024, transparent, for the Wails desktop shell
 *
 * And for Google Play, in fastlane/metadata/android/<lang>/images/:
 *   icon.png             : 512 on white, RGB
 *   featureGraphic.png   : #0d1117 1024x500, logo, name and claim, RGB
 *
 * The master reads on both grounds, so both themes embed the same file and only
 * the text colours flip. Banner layout: logo ink about 400px with its left edge
 * at x=165 and its centre at y=250, name 132, claim 44, logo-to-text gap 70,
 * name-to-claim gap 8.
 *
 * Fonts (OFL) are fetched to the OS temp dir at runtime.
 * Deps (global): @resvg/resvg-js, opentype.js.
 *
 * Run: node .github/assets/render-assets.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const gRoot = execSync('npm root -g').toString().trim();
const { Resvg } = require(`${gRoot}/@resvg/resvg-js`);
const opentype = require(`${gRoot}/opentype.js`);
const here = (p) => new URL(p, import.meta.url);

const NAME = 'ArrowLoop';
const CLAIM = 'Fires both ways. Loses nothing.';
const W = 1600, H = 500;
const INK = 400;                                   // largest ink dimension
const nameSize = 132, claimSize = 44, gap = 70, lineGap = 8;
const THEMES = [
  { suffix: '',      bg: '#ffffff', name: '#1f2328', claim: '#5a5d5e' },
  { suffix: '-dark', bg: '#0d1117', name: '#e6edf3', claim: '#9aa4ad' },
];

const master = readFileSync(here('./icon.svg'), 'utf8').replace(/<\?xml[^>]*\?>\s*/, '');
const vb = (master.match(/viewBox="([^"]+)"/) || [, '0 0 1000 1000'])[1];
const [vbX, vbY, vbW, vbH] = vb.split(/[\s,]+/).map(Number);

// Anchored by ink rather than by the box, since a mark inset in its viewBox would
// otherwise sit off the 165 line. innerBBox is in the master's own user units.
const ink = new Resvg(Buffer.from(master)).innerBBox();
if (!ink) throw new Error('no ink bbox from the master');
const scale = INK / Math.max(ink.width, ink.height);
const boxW = vbW * scale, boxH = vbH * scale;
const LX = 165 - (ink.x - vbX) * scale;            // ink left edge lands on 165
const LY = 250 - ((ink.y - vbY) + ink.height / 2) * scale;   // ink centre on H/2
const textX = 165 + ink.width * scale + gap;

const embed = (x, y, w, h) => master.replace(/<svg\b[^>]*>/,
  `<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">`);
const png = (svg, size, bg) =>
  new Resvg(Buffer.from(svg), { fitTo: { mode: 'width', value: size }, background: bg || 'rgba(0,0,0,0)' }).render().asPng();

async function getFont(file, url) {
  const p = join(tmpdir(), file);
  if (!existsSync(p)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font fetch ${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const want = Number(res.headers.get('content-length') || 0);
    if (want && buf.length !== want) throw new Error(`short font download: ${buf.length}/${want}`);
    writeFileSync(p, buf);
  }
  const b = readFileSync(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// The ring and gold arrow read on Unraid's dark page without a tile behind them.
for (const [file, size] of [['icon.png', 512], ['favicon.png', 256], ['appicon.png', 1024]]) {
  writeFileSync(here('./' + file), png(master, size));
}

const bree = await getFont('ArrowLoop-BreeSerif-Regular.ttf',
  'https://github.com/google/fonts/raw/main/ofl/breeserif/BreeSerif-Regular.ttf');
const lato = await getFont('ArrowLoop-Lato-Regular.ttf',
  'https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf');

const nameAsc = bree.ascender * (nameSize / bree.unitsPerEm);
const nameDesc = -bree.descender * (nameSize / bree.unitsPerEm);
const claimAsc = lato.ascender * (claimSize / lato.unitsPerEm);
const blockH = nameAsc + nameDesc + lineGap + claimAsc;
const nameBaseline = H / 2 - blockH / 2 + nameAsc;
const claimBaseline = nameBaseline + nameDesc + lineGap + claimAsc;

// opentype.js emits a NaN control point for some glyphs at a large absolute x
// (Lato's "e" in "Loses"), so every glyph is built at x=0 and moved into place by
// a transform, with advance plus kerning stepped by hand as getPath would. This
// also avoids resvg dropping the tail of a long merged path.
function glyphs(font, text, size) {
  const scale = size / font.unitsPerEm;
  const gs = font.stringToGlyphs(text);
  const out = [];
  let x = 0;
  for (let i = 0; i < gs.length; i++) {
    const d = gs[i].getPath(0, 0, size).toPathData(2);
    if (d.includes('NaN')) throw new Error(`NaN in "${text[i]}" even at the origin`);
    if (d) out.push({ d, x });
    x += gs[i].advanceWidth * scale;
    if (i + 1 < gs.length) x += font.getKerningValue(gs[i], gs[i + 1]) * scale;
  }
  return out;
}
const nameGlyphs = glyphs(bree, NAME, nameSize);
const claimGlyphs = glyphs(lato, CLAIM, claimSize);
const paint = (gl, y, fill) =>
  gl.map((g) => `<path transform="translate(${g.x.toFixed(2)},${y.toFixed(2)})" d="${g.d}" fill="${fill}"/>`).join('\n    ');
const rightEdge = textX + Math.max(bree.getAdvanceWidth(NAME, nameSize), lato.getAdvanceWidth(CLAIM, claimSize));
if (W - rightEdge < 120) throw new Error(`right margin ${(W - rightEdge).toFixed(0)}px, house minimum is 120`);

for (const t of THEMES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${embed(LX, LY, boxW, boxH)}
  <g transform="translate(${textX.toFixed(2)},0)">
    ${paint(nameGlyphs, nameBaseline, t.name)}
    ${paint(claimGlyphs, claimBaseline, t.claim)}
  </g>
</svg>
`;
  writeFileSync(here(`./banner${t.suffix}.svg`), svg);
  writeFileSync(here(`./banner${t.suffix}.png`), png(svg, W, t.bg));
}

const logoOnly = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  ${embed((W - boxW) / 2, (H - boxH) / 2, boxW, boxH)}
</svg>
`;
writeFileSync(here('./banner-logo.svg'), logoOnly);
writeFileSync(here('./banner-logo.png'), png(logoOnly, W, '#ffffff'));

// Google Play: the listing icon on the adaptive icon's white, inset so the
// store's rounded mask cannot clip the ring, and the 1024x500 feature graphic
// in the dark banner's colours, without an alpha channel, which Play refuses.
const PW = 1024, PH = 500, PINK = 300, pName = 92, pClaim = 31, pGap = 48;
const pScale = PINK / Math.max(ink.width, ink.height);
const pNameW = bree.getAdvanceWidth(NAME, pName), pClaimW = lato.getAdvanceWidth(CLAIM, pClaim);
const pLeft = (PW - (ink.width * pScale + pGap + Math.max(pNameW, pClaimW))) / 2;
const pTextX = pLeft + ink.width * pScale + pGap;
const pNameAsc = bree.ascender * (pName / bree.unitsPerEm);
const pNameDesc = -bree.descender * (pName / bree.unitsPerEm);
const pClaimAsc = lato.ascender * (pClaim / lato.unitsPerEm);
const pNameBase = PH / 2 - (pNameAsc + pNameDesc + lineGap + pClaimAsc) / 2 + pNameAsc;
const dark = THEMES[1];
const feature = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}">
  <rect width="${PW}" height="${PH}" fill="${dark.bg}"/>
  ${embed(pLeft - (ink.x - vbX) * pScale, PH / 2 - ((ink.y - vbY) + ink.height / 2) * pScale, vbW * pScale, vbH * pScale)}
  <g transform="translate(${pTextX.toFixed(2)},0)">
    ${paint(glyphs(bree, NAME, pName), pNameBase, dark.name)}
    ${paint(glyphs(lato, CLAIM, pClaim), pNameBase + pNameDesc + lineGap + pClaimAsc, dark.claim)}
  </g>
</svg>
`;
const iconInk = 400, iconScale = iconInk / Math.max(ink.width, ink.height);
const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#ffffff"/>
  ${embed(256 - ((ink.x - vbX) + ink.width / 2) * iconScale, 256 - ((ink.y - vbY) + ink.height / 2) * iconScale, vbW * iconScale, vbH * iconScale)}
</svg>
`;
// resvg only writes RGBA, so the opaque files are encoded here as RGB.
function rgbPng(svg, width, bg) {
  const img = new Resvg(Buffer.from(svg), { fitTo: { mode: 'width', value: width }, background: bg }).render();
  const { width: w, height: h, pixels } = img;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels.copy(raw, y * (w * 3 + 1) + 1 + x * 3, (y * w + x) * 4, (y * w + x) * 4 + 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const lang of ['en-US', 'de-DE']) {
  const dir = new URL(`../../fastlane/metadata/android/${lang}/images/`, import.meta.url);
  writeFileSync(new URL('featureGraphic.png', dir), rgbPng(feature, PW, dark.bg));
  writeFileSync(new URL('icon.png', dir), rgbPng(playIcon, 512, '#ffffff'));
}

console.log(`ink ${ink.width.toFixed(1)}x${ink.height.toFixed(1)} in ${vbW}x${vbH}, right margin ${(W - rightEdge).toFixed(0)}px`);
console.log('wrote icon.png, favicon.png, appicon.png, banner{,-dark,-logo}.{svg,png}, and the Play icon and feature graphic');
