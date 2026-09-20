"""Generate the README's download buttons from one template.

Two rows: the desktop builds, then the container and the Android app.

Height and corner radius are the Buy Me a Coffee button's (245.3 tall, rx 38.2),
so both stand the same height at the same width. The width is 720 rather than
841.9, which left a third of the face empty beside the longest word.

Each button is filled in its platform's colour and has no outline. macOS takes
Apple's space grey, since black disappears into GitHub's dark theme.

The logos are the platforms' own marks from Font Awesome Free (CC BY 4.0 for the
icons; see scripts/brand-paths/). Each is a trademark of its owner, used
unmodified and only to name the platform a button downloads for, with no claim
of endorsement by or affiliation with Microsoft, Apple, the Linux Foundation,
Docker or Google.

Run from anywhere:  python scripts/gen_download_buttons.py
Writes .github/assets/download-buttons/*.svg, which are committed, and the
button rows in README.md between their markers, all of them showing one
sprite, .github/assets/download-buttons/buttons.svg.
"""

import http.client
import io
import math
import os
import re
import time
import urllib.error
import urllib.request
from html import escape

HERE = os.path.dirname(os.path.abspath(__file__))
# Relative to this file, so the generator works from any working directory.
OUT = os.path.join(HERE, "..", ".github", "assets", "download-buttons")
BRANDS = os.path.join(HERE, "brand-paths")

W, H, R = 720.0, 245.3, 38.2

# The mark is drawn into a square this tall, centred vertically, inset from the
# left. Its own viewBox decides the horizontal centring, because the three marks
# are not equally wide: Apple's is 384 units against Windows' and Tux's 448.
GLYPH = 112.0
GX, GY = 78.0, (H - GLYPH) / 2

# A system stack, because an SVG loaded through <img> cannot fetch a webfont.
# The layout leaves room for a face wider than the one it was measured with.
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

# The band moves linearly, since an eased pass changes speed inside each button
# and breaks the hand-off at the seam. `backwards` holds a delayed band at its
# start off the left edge; otherwise it would sit still inside the button until
# its delay ran out. The band is taller than the canvas and skewed rather than
# rotated, so the tilt never shows a corner and the motion stays one translate.
TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{alt}">
  <title>{alt}</title>
  <defs>
    <clipPath id="edge">
      <rect x="0" y="0" width="{w}" height="{h}" rx="{r}" ry="{r}"/>
    </clipPath>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"    stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.45" stop-color="#fff" stop-opacity="0.28"/>
      <stop offset="0.55" stop-color="#fff" stop-opacity="0.28"/>
      <stop offset="1"    stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <style>
    @keyframes pass {{
      0%       {{ transform: translateX({band_start}px); }}
      {pass_pct}%   {{ transform: translateX({band_end}px); }}
      100%     {{ transform: translateX({band_end}px); }}
    }}
    .band {{ animation: pass {cycle}s linear {delay}s infinite backwards; }}
    @media (prefers-reduced-motion: reduce) {{
      .band {{ animation: none; opacity: 0; }}
    }}
  </style>
  <rect width="{w}" height="{h}" rx="{r}" ry="{r}" fill="{bg}"/>
  <g transform="translate({gx} {gy}) scale({scale})" fill="{ink}">
    <path d="{path}"/>
  </g>
  <text x="238" y="110" font-family="{font}" font-size="82" font-weight="700" fill="{ink}">{head}</text>
  <text x="240" y="180" font-family="{font}" font-size="50" font-weight="400" fill="{ink}" fill-opacity="0.72">{sub_text}</text>
  <g clip-path="url(#edge)">
    <g class="band">
      <rect x="0" y="-60" width="{band_w}" height="{band_h}"
            fill="url(#sheen)" transform="skewX(-16)"/>
    </g>
  </g>
</svg>
"""

# The sheen is a tilted white band, clipped to each button, that appears to
# travel along the whole row, the same band as the donation row's. Its numbers
# are in screen pixels, since the canvases (720 here, 841.9 for the donation row)
# and their rendered widths differ.
#
# The row is `<img width="195">` separated by a newline, two spaces and a
# `&nbsp;`, which HTML collapses to 13.16px at GitHub's 16px body text. A
# `&nbsp;` glued to `</a>` measures 8.77px, so the separator is part of the rule.
BAND_PX = 33.0     # the band's width on screen
SPEED = 250.0      # screen pixels per second
GAP_PX = 13.16     # measured, see above
RENDER_PX = 195.0  # the width the README asks for

SCALE = W / RENDER_PX              # canvas units per screen pixel
SHEEN_W = BAND_PX * SCALE
# skewX shifts every point by tan(16 degrees) times its y, so clearing the edge
# by the rect's width alone would leave the tilted corner showing.
SHEEN_H = H + 120.0
CLEAR = SHEEN_W + math.tan(math.radians(16)) * SHEEN_H
SHEEN_FROM = -CLEAR
SHEEN_TO = W + CLEAR
# The time to cross one button and to travel to the next one's left edge, from
# one speed, so the band leaves one button as it enters the next.
PASS = (SHEEN_TO - SHEEN_FROM) / SCALE / SPEED
STEP = (RENDER_PX + GAP_PX) / SPEED

# slug, brand file, background, ink, heading, second line, accessible name, and
# where the button leads (see write_readme()). One list per row, top to bottom.
RELEASE = "https://github.com/junkerderprovinz/arrowloop/releases/latest/download/"
DESKTOP = [
    ("windows-installer", "windows", "#0078d4", "#ffffff", "Windows", "Installer", "Download for Windows, installer",
     RELEASE + "arrowloop-windows-amd64-installer.exe"),
    ("windows-portable", "windows", "#0078d4", "#ffffff", "Windows", "Portable", "Download for Windows, portable",
     RELEASE + "arrowloop-windows-amd64-portable.exe"),
    # Space grey, since black vanishes against GitHub's dark theme.
    ("macos", "apple", "#6e6e73", "#ffffff", "macOS", "Universal", "Download for macOS",
     RELEASE + "arrowloop-macos-universal.dmg"),
    # Tux yellow, with dark ink for contrast.
    ("linux", "linux", "#fcc624", "#1b1b1b", "Linux", "amd64", "Download for Linux",
     RELEASE + "arrowloop-linux-amd64"),
]
SERVER_AND_PHONE = [
    # The container has no file to download, so this one leads to the image's
    # own page, which carries the pull command and every tag.
    ("docker", "docker", "#1d63ed", "#ffffff", "Docker", "Container", "Run it with Docker",
     "https://github.com/junkerderprovinz/arrowloop/pkgs/container/arrowloop"),
    # arm64 only; the x86_64 APK is for emulators and stays on the release page.
    ("android", "android", "#3ddc84", "#1b1b1b", "Android", "App", "Download the Android app",
     RELEASE + "arrowloop-android-arm64.apk"),
]
ROWS = [DESKTOP, SERVER_AND_PHONE]
BUTTONS = [button for buttons in ROWS for button in buttons]

# The README rows are written here too, between markers: both download rows
# (one marked block) and every donation row.
#
# Every button on the page shows one file, buttons.svg, through its own
# #svgView fragment. The shine's clock starts when an <img> gets its file, and
# separate files arrive at separate moments (Firefox also reuses a cached image
# across GitHub's in-page navigation), so the band would jump between buttons.
# The donation buttons are copied in for the same reason. The sprite layout is
# explained in junkerderprovinz/junkerderprovinz, donate/buttons/sprite.mjs.
#
# The donation buttons are read from the profile repository, so run this again
# after they change there. The sprite is read from main, so a branch's README
# preview shows main's buttons.
REPO = "arrowloop"
SPRITE = os.path.join(OUT, "buttons.svg")
SPRITE_URL = "https://raw.githubusercontent.com/junkerderprovinz/%s/main/.github/assets/download-buttons/buttons.svg" % REPO
GIVE_URL = "https://raw.githubusercontent.com/junkerderprovinz/junkerderprovinz/main/donate/buttons/button-%s-live.svg"
GIVE_RENDER_PX = 160.0
# slug, where it leads, accessible name. The same three as in every README.
GIVE = [
    ("buy-me-a-coffee", "https://buymeacoffee.com/junkerderprovinz", "Buy me a coffee"),
    ("paypal", "https://www.paypal.com/donate/?hosted_button_id=76FVV52TKXTUS", "PayPal"),
    ("crypto", "https://junkerderprovinz.github.io/junkerderprovinz/", "Donate with crypto"),
]
README = os.path.join(HERE, "..", "README.md")
ROW_OPEN = "<!-- download-buttons: written by scripts/gen_download_buttons.py -->"
ROW_CLOSE = "<!-- /download-buttons -->"
GIVE_OPEN = "<!-- give-buttons: written by scripts/gen_download_buttons.py -->"
GIVE_CLOSE = "<!-- /give-buttons -->"

def brand(name):
    """One mark: its path, and the scale and offset that centre it in GLYPH."""
    path = io.open(os.path.join(BRANDS, name + ".txt"), encoding="utf-8").read().strip()
    box = io.open(os.path.join(BRANDS, name + ".box.txt"), encoding="utf-8").read().strip()
    _, _, width, height = (float(n) for n in box.split())
    # Scaled by height so the marks share an optical size, then nudged right by
    # half the width they do not use, since Apple's mark is narrower.
    scale = GLYPH / height
    return path, scale, (GLYPH - width * scale) / 2


def num(x):
    """A coordinate as the fragment carries it: no trailing zeros, no float noise."""
    return ("%.3f" % x).rstrip("0").rstrip(".")


# The names a button document defines, each prefixed per button in the sprite. A
# name left without a prefix is refused, since it would hand one button's delay
# or clip to all of them.
UNPREFIXED = re.compile(r'id="(?!b\d+-)|url\(#(?!b\d+-)|href="#(?!b\d+-)|class="(?!b\d+-)|@keyframes (?!b\d+-)|animation: (?!b\d+-|none)')


def sprite(parts):
    """Several button documents as one SVG, laid out left to right.

    Every part keeps its own document as a nested <svg> at its own x, with its
    ids, class and keyframes prefixed, because the CSS inside one SVG document
    is shared: unprefixed, the last button's delay would win for all of them.
    Returns the sprite and each part's x.
    """
    x, xs, body = 0.0, [], []
    for i, (svg, width, _height) in enumerate(parts):
        pre = "b%d-" % i
        s = re.sub(r"<\?xml[^>]*>\s*", "", svg, count=1)
        s = re.sub(r"<!--.*?-->\s*", "", s, flags=re.S)
        s = re.sub(r'id="(edge|sheen)"', lambda m: 'id="%s%s"' % (pre, m.group(1)), s)
        s = re.sub(r"url\(#(edge|sheen)\)", lambda m: "url(#%s%s)" % (pre, m.group(1)), s)
        s = s.replace('class="band"', 'class="%sband"' % pre)
        s = re.sub(r"\.band\b", ".%sband" % pre, s)
        s = re.sub(r"@keyframes pass\b", "@keyframes %spass" % pre, s)
        s = s.replace("animation: pass ", "animation: %spass " % pre)
        s = re.sub(r"<svg\b", '<svg x="%s" y="0"' % num(x), s, count=1)
        left = UNPREFIXED.search(s)
        if left:
            raise SystemExit("button %d still has an unprefixed name near %r" % (i, s[left.start():left.start() + 40]))
        xs.append(x)
        body.append(s.strip())
        x = round(x + width, 3)
    height = max(p[2] for p in parts)
    head = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            'viewBox="0 0 %s %s">\n' % (num(x), num(height)))
    return head + "\n".join(body) + "\n</svg>\n", xs


def give_buttons():
    """The donation buttons' own files and sizes, as the profile repository publishes them.

    The size is read from each file's viewBox rather than assumed, because the
    other repository decides it. The query string gets past raw.githubusercontent's
    five-minute cache, so a run right after a change there sees the change.
    """
    out = []
    for slug, _href, _alt in GIVE:
        url = GIVE_URL % slug + "?t=%d" % time.time()
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    svg = r.read().decode("utf-8")
                break
            except urllib.error.HTTPError as err:
                if err.code < 500 or attempt == 2:
                    raise SystemExit("%s: HTTP %d" % (url, err.code))
            except (OSError, http.client.HTTPException):
                # A dropped connection, also halfway through the body. Nothing
                # has been written yet, so trying again is safe.
                if attempt == 2:
                    raise
            time.sleep(2)
        box = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
        if not box:
            raise SystemExit("%s has no viewBox" % url)
        out.append((svg, float(box.group(1)), float(box.group(2))))
    return out


def blocks(text, opener, closer):
    """Every opener ... closer span in the text, in order.

    An opener whose closer is missing is refused rather than paired with the
    next block's closer, which would replace everything in between.
    """
    spans, at = [], 0
    while True:
        start = text.find(opener, at)
        if start < 0:
            return spans
        end = text.find(closer, start)
        following = text.find(opener, start + len(opener))
        if end < 0 or (0 <= following < end):
            raise SystemExit("README.md has %s without its %s" % (opener, closer))
        spans.append((start, end))
        at = end + len(closer)


def read_readme():
    """README.md, read after the donation buttons are fetched so an edit saved
    meanwhile survives, and checked before any file is written.

    REPO is checked against the links, since a copy of this file in another
    repository would otherwise show this repository's buttons there.
    """
    text = io.open(README, encoding="utf-8", newline="").read()
    if len(blocks(text, ROW_OPEN, ROW_CLOSE)) != 1:
        raise SystemExit("README.md needs exactly one %s ... %s" % (ROW_OPEN, ROW_CLOSE))
    if not blocks(text, GIVE_OPEN, GIVE_CLOSE):
        raise SystemExit("README.md has no %s ... %s" % (GIVE_OPEN, GIVE_CLOSE))
    for slug, *_, href in BUTTONS:
        if "/%s/" % REPO not in href:
            raise SystemExit("REPO is %r, but %s leads to %s" % (REPO, slug, href))
    return text


def row(items, nl):
    """One centred row: a link per button, the separator on its own line, two
    spaces in, because that is the gap GAP_PX was measured on."""
    lines = ['<p align="center">']
    for index, (href, alt, x, width, height, render) in enumerate(items):
        if index:
            lines.append("  &nbsp;")
        lines.append('  <a href="%s"><img src="%s#svgView(viewBox(%s,0,%s,%s))" alt="%s" width="%s" height="%s"></a>'
                     % (escape(href), SPRITE_URL, num(x), num(width), num(height), escape(alt), num(render), num(render * height / width)))
    lines.append("</p>")
    return nl.join(lines) + nl


def write_readme(text, xs, gives):
    """Replace every marked block, each taking the line ending of its own marker.

    Both width and height are set, because the image's own proportions are the
    whole sprite's, not the button's.
    """
    downloads, at = [], 0
    for buttons in ROWS:
        downloads.append([(href, alt, xs[at + i], W, H, RENDER_PX) for i, (_s, *_, alt, href) in enumerate(buttons)])
        at += len(buttons)
    donations = [[(href, alt, xs[len(BUTTONS) + i], gives[i][1], gives[i][2], GIVE_RENDER_PX)
                  for i, (_s, href, alt) in enumerate(GIVE)]]
    for opener, closer, rows in ((ROW_OPEN, ROW_CLOSE, downloads), (GIVE_OPEN, GIVE_CLOSE, donations)):
        for start, end in reversed(blocks(text, opener, closer)):
            nl = "\r\n" if text[start:].split("\n", 1)[0].endswith("\r") else "\n"
            text = text[:start] + opener + nl + "".join(row(items, nl) for items in rows) + text[end:]
    io.open(README, "w", encoding="utf-8", newline="").write(text)
    print("README.md  download rows of %s, donation rows of %d" % ("+".join(str(len(r)) for r in ROWS), len(GIVE)))


ANIMATION = re.compile(r"animation: pass (\d+(?:\.\d+)?)s linear (\d+(?:\.\d+)?)s infinite backwards;")
PASS_STOP = re.compile(r"^(\s*)(\d+(?:\.\d+)?)%(\s+\{ transform: translateX\()", re.M)


def retime(svg, delay, cycle):
    """A donation button moved to its place in this page's longer loop.

    The band's time across the button is read from the file, since its geometry
    belongs to the profile repository. Anything but the one expected animation
    and keyframe stops the run rather than leaving one button on its old clock.
    """
    found = ANIMATION.findall(svg)
    stops = [m for m in PASS_STOP.finditer(svg) if float(m.group(2)) not in (0.0, 100.0)]
    if len(found) != 1 or len(stops) != 1:
        raise SystemExit("a donation button no longer has the one animation and keyframe this retimes")
    crossing = float(stops[0].group(2)) / 100.0 * float(found[0][0])
    stop = stops[0]
    svg = svg[:stop.start()] + "%s%.2f%%%s" % (stop.group(1), crossing / cycle * 100.0, stop.group(3)) + svg[stop.end():]
    return ANIMATION.sub("animation: pass %gs linear %.3fs infinite backwards;" % (cycle, delay), svg)


# One band works down the page: the donation row, then the desktop row, then the
# row below. Each button starts one step after its neighbour, and each row where
# a further button of the row above would have started. Computed, so reordering
# a row cannot break the hand-off.
#
# The donation row stands above the download rows here, so it is retimed. Its
# house schedule starts at 3.8 s in a seven second loop, but three rows need
# 7.07 s of travel, so this loop is the three rows plus the house rest of 1.12 s
# (7 s minus the end of the donation row there).
#
# Every delay stays inside the loop: all clocks start together, and a delay past
# the loop would make a button shine before everything above it.
GIVE_STEP = (GIVE_RENDER_PX + GAP_PX) / SPEED
HOUSE_CYCLE, HOUSE_GIVE_START = 7.0, 3.8
REST = HOUSE_CYCLE - (HOUSE_GIVE_START + len(GIVE) * GIVE_STEP)
DELAYS, at = [], len(GIVE) * GIVE_STEP
GIVE_DELAYS = [GIVE_STEP * i for i in range(len(GIVE))]
for buttons in ROWS:
    DELAYS += [at + STEP * i for i in range(len(buttons))]
    at += len(buttons) * STEP
CYCLE = round(max(HOUSE_CYCLE, at + REST), 3)
PASS_PCT = PASS / CYCLE * 100.0

gives = give_buttons()
readme = read_readme()
svgs = []
for index, (slug, mark, bg, ink, head, sub_text, alt, _href) in enumerate(BUTTONS):
    path, scale, inset = brand(mark)
    svgs.append((slug, TEMPLATE.format(
        w=W, h=H, r=R, bg=bg, ink=ink, gx=round(GX + inset, 2), gy=round(GY, 2),
        scale=round(scale, 5), path=path, font=FONT,
        head=head, sub_text=sub_text, alt=escape(alt),
        delay="%.3f" % DELAYS[index], cycle="%g" % CYCLE,
        pass_pct="%.2f" % PASS_PCT, band_w="%.1f" % SHEEN_W,
        band_h="%g" % SHEEN_H, band_start="%.1f" % SHEEN_FROM,
        band_end="%.1f" % SHEEN_TO,
    )))
gives = [(retime(svg, GIVE_DELAYS[i], CYCLE), width, height) for i, (svg, width, height) in enumerate(gives)]
# Built, and checked, before anything is written.
whole, xs = sprite([(svg, W, H) for _slug, svg in svgs] + gives)
os.makedirs(OUT, exist_ok=True)
for slug, svg in svgs:
    out = os.path.join(OUT, "button-" + slug + ".svg")
    io.open(out, "w", encoding="utf-8", newline="\n").write(svg)
    print("wrote", os.path.normpath(out), len(svg), "bytes")
io.open(SPRITE, "w", encoding="utf-8", newline="\n").write(whole)
print("wrote", os.path.normpath(SPRITE), len(whole), "bytes,", len(xs), "buttons")
write_readme(readme, xs, gives)
