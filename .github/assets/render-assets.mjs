/**
 * Generates every ArrowLoop image from ONE master: icon.svg (jdp's artwork,
 * embedded verbatim, never redrawn).
 *
 * Outputs, all in this folder:
 *   icon.png             : CA icon, 512, transparent — the gold arrow and the
 *                          light ring carry the shape on Unraid's dark page.
 *   banner.png/.svg      : white 1600x500, logo + "ArrowLoop" + claim   [README light]
 *   banner-dark.png/.svg : #0d1117 1600x500, same                        [README <picture> dark]
 *   banner-logo.png/.svg : white 1600x500, logo only, no text            [support thread]
 *   favicon.png          : 256, transparent, for the web UI
 *   appicon.png          : 1024, transparent, for the Wails desktop shell
 *
 * The master reads on both grounds (mid-grey ring plus gold), so both themes
 * embed the same file and only the text colours flip.
 *
 * House banner standard (vault "Style Guide - GitHub"): 1600x500, logo ink
 * ~400px anchored with its INK left edge at x=165 and its ink centre at y=250,
 * name 132 / claim 44 / logo-to-text gap 70 / name-to-claim gap 8.
 *
 * viewBox-agnostic: the embed reads the master's own viewBox. Fonts (OFL) are
 * fetched to the OS temp dir at runtime, never committed.
 * Deps (global): @resvg/resvg-js, opentype.js.
 *
 * Run: node .github/assets/render-assets.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const gRoot = execSync('npm root -g').toString().trim();
const { Resvg } = require(`${gRoot}/@resvg/resvg-js`);
const opentype = require(`${gRoot}/opentype.js`);
const here = (p) => new URL(p, import.meta.url);

// ---- content + styling ------------------------------------------------------
const NAME = 'ArrowLoop';
const CLAIM = 'Fires both ways. Loses nothing.';
const W = 1600, H = 500;
const INK = 400;                                   // largest ink dimension
const nameSize = 132, claimSize = 44, gap = 70, lineGap = 8;
const THEMES = [
  { suffix: '',      bg: '#ffffff', name: '#1f2328', claim: '#5a5d5e' },
  { suffix: '-dark', bg: '#0d1117', name: '#e6edf3', claim: '#9aa4ad' },
];
// -----------------------------------------------------------------------------

const master = readFileSync(here('./icon.svg'), 'utf8').replace(/<\?xml[^>]*\?>\s*/, '');
const vb = (master.match(/viewBox="([^"]+)"/) || [, '0 0 1000 1000'])[1];
const [vbX, vbY, vbW, vbH] = vb.split(/[\s,]+/).map(Number);

// Anchor by INK, not by the box: a mark inset in its viewBox would otherwise sit
// off the 165 line. innerBBox is in the master's own user units.
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

// ---- 1) square logo PNGs (CA icon, favicon, desktop shell) ------------------
// Transparent: the mark is a ring plus a gold arrow, so it reads on Unraid's
// dark page without a tile behind it, and a solid square would just be a box.
for (const [file, size] of [['icon.png', 512], ['favicon.png', 256], ['appicon.png', 1024]]) {
  writeFileSync(here('./' + file), png(master, size));
}

// ---- 2) banners ------------------------------------------------------------
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

// opentype.js emits a NaN control point for some glyph/absolute-x combinations:
// here Lato's "e" in "Loses" is clean at the origin and NaN once its cumulative
// advance carries it far enough right. Measured, not guessed. So every glyph is
// built at x=0 and carried to its place by a transform, and the advances are
// stepped by hand (advance plus kerning, exactly what getPath does internally)
// because that is the only way to keep opentype.js away from the poisoned
// coordinate. This also sidesteps resvg's tail-drop on long merged paths.
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

// ---- 3) text-free banner for the support thread ----------------------------
const logoOnly = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  ${embed((W - boxW) / 2, (H - boxH) / 2, boxW, boxH)}
</svg>
`;
writeFileSync(here('./banner-logo.svg'), logoOnly);
writeFileSync(here('./banner-logo.png'), png(logoOnly, W, '#ffffff'));

console.log(`ink ${ink.width.toFixed(1)}x${ink.height.toFixed(1)} in ${vbW}x${vbH}, right margin ${(W - rightEdge).toFixed(0)}px`);
console.log('wrote icon.png, favicon.png, appicon.png, banner{,-dark,-logo}.{svg,png}');
