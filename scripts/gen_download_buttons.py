"""Generate the README's four download buttons from one template.

From a template, because four hand-drawn buttons are four chances to type one
number differently, and the whole point of a row of them is that they look like
one control repeated.

THE GEOMETRY. Height and corner radius are the Buy Me a Coffee button's own
(245.3 tall, rx 38.2), so a download button and the coffee button rendered at
the same width stand the same height. The WIDTH is 720 rather than that button's
841.9, measured on screen rather than guessed: at 841.9 a third of the face sat
empty to the right of the longest word and the button read as lopsided.

THE COLOUR is the platform's own, and the button has no outline (jdp: "die
butotns sollen keine rahmenliniehaben und farbig sein"). A filled shape in a
colour somebody already associates with the platform does the work an outline
was doing, and does it faster: the eye finds "the blue one" before it reads the
word. macOS has no brand colour of its own, so it takes Apple's own space grey,
which is the one value that stays visible against GitHub's light theme and its
dark one - a black button disappears into the dark theme, and this row has no
outline to save it.

THE LOGOS are the platforms' own marks, from Font Awesome Free (CC BY 4.0 for
the icons; see scripts/brand-paths/). Each mark is a trademark of its owner and
is used here the one way a trademark may be used without permission: to name the
thing it refers to. Each button links to a download FOR that platform, the marks
are unmodified, and nothing here claims endorsement by or affiliation with
Microsoft, Apple or the Linux Foundation.

Run from anywhere:  python scripts/gen_download_buttons.py
Writes .github/assets/download-buttons/*.svg, which are committed, and the
button row in README.md between its two markers.
"""

import io
import math
import os
from html import escape

HERE = os.path.dirname(os.path.abspath(__file__))
# Relative to this file, so the generator works from any working directory and
# in any repo it is copied into.
OUT = os.path.join(HERE, "..", ".github", "assets", "download-buttons")
BRANDS = os.path.join(HERE, "brand-paths")

W, H, R = 720.0, 245.3, 38.2

# The mark is drawn into a square this tall, centred vertically, inset from the
# left. Its own viewBox decides the horizontal centring, because the three marks
# are not equally wide: Apple's is 384 units against Windows' and Tux's 448.
GLYPH = 112.0
GX, GY = 78.0, (H - GLYPH) / 2

# A system stack, because an SVG loaded through <img> cannot fetch a webfont:
# whatever is named here has to already be on the reader's machine. The layout
# leaves room to the right of the longest word for a face wider than the one
# this was measured with.
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

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
    /* linear, not eased: an eased pass varies the speed inside each button, so
       the hand-off at the seam arrives early or late and the row stops reading
       as one band.

       The fill mode is not decoration, it is the second half of the delay. An
       animation that has not started yet leaves its element wherever the
       document put it, which for this band is x=0 - INSIDE the button, against
       its left edge. Without it the stagger that makes the row read as one band
       also parks a motionless band on every button but the first, for as long
       as that button's delay, every time the page loads. */
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
      <!-- Taller than the canvas and started off its left edge, so the tilt
           never exposes a corner. skewX rather than rotate: the band stays
           axis-aligned for the translate, so the motion is one transform. -->
      <rect x="0" y="-60" width="{band_w}" height="{band_h}"
            fill="url(#sheen)" transform="skewX(-16)"/>
    </g>
  </g>
</svg>
"""

# THE SHEEN, and it is DEFINED ON SCREEN rather than on this canvas.
#
# A tilted white band, clipped to the button, crossing once every seven seconds.
# It is the donation row's own band, and the point is that it is the SAME band
# there and here: a row of house buttons carries one band that appears to travel
# the whole row, and two rows on one page have to look like one effect rather
# than two.
#
# That is why these three numbers are in SCREEN pixels (see the GitHub style
# guide, "Der Schein"). Described in canvas units they come out different in
# every row, because the canvases differ (720 here, 841.9 for the donation row)
# and so do the widths the READMEs render them at.
#
# THE GAP IS MEASURED, not assumed: the row is `<img width="195">` with a
# newline, two spaces and a `&nbsp;` between the images, which HTML collapses to
# space-nbsp-space, 13.16px at GitHub's 16px body text. A `&nbsp;` glued to the
# closing `</a>` instead measures 8.77px, so the separator is part of the rule.
BAND_PX = 33.0     # the band's width on screen
SPEED = 250.0      # screen pixels per second
GAP_PX = 13.16     # measured, see above
RENDER_PX = 195.0  # the width the README asks for
CYCLE = 7.0        # seconds, one full loop including the rest

SCALE = W / RENDER_PX              # canvas units per screen pixel
SHEEN_W = BAND_PX * SCALE
# The band is skewed, so its horizontal extent is wider than the rect: skewX
# shifts every point by tan(16 degrees) times its own y, and the rect is taller
# than the canvas on both sides. Clearing the edge by the rect's width alone
# would leave the tilted corner showing.
SHEEN_H = H + 120.0
CLEAR = SHEEN_W + math.tan(math.radians(16)) * SHEEN_H
SHEEN_FROM = -CLEAR
SHEEN_TO = W + CLEAR
# How long the band needs to cross one button, and how long to travel from one
# button's left edge to the next one's. Both come from one speed, so the band
# leaves button n at the moment it enters button n+1.
PASS = (SHEEN_TO - SHEEN_FROM) / SCALE / SPEED
STEP = (RENDER_PX + GAP_PX) / SPEED
PASS_PCT = PASS / CYCLE * 100.0

# slug, brand file, background, ink, heading, second line, accessible name, and
# where the button leads. The last one lives here with the rest of the button
# because this file writes the README row too, see write_readme().
RELEASE = "https://github.com/junkerderprovinz/arrowloop/releases/latest/download/"
BUTTONS = [
    ("windows-installer", "windows", "#0078d4", "#ffffff", "Windows", "Installer", "Download for Windows, installer",
     RELEASE + "arrowloop-windows-amd64-installer.exe"),
    ("windows-portable", "windows", "#0078d4", "#ffffff", "Windows", "Portable", "Download for Windows, portable",
     RELEASE + "arrowloop-windows-amd64-portable.exe"),
    # Apple's own space grey. Black is the usual answer and the wrong one here:
    # with no outline it vanishes against GitHub's dark theme.
    ("macos", "apple", "#6e6e73", "#ffffff", "macOS", "Universal", "Download for macOS",
     RELEASE + "arrowloop-macos-universal.dmg"),
    # The yellow Tux is drawn in, dark ink on it for the same reason road signs
    # do that.
    ("linux", "linux", "#fcc624", "#1b1b1b", "Linux", "amd64", "Download for Linux",
     RELEASE + "arrowloop-linux-amd64"),
]

# THE README ROW is written here as well, between two markers, so a button added
# to BUTTONS reaches the page by running this file and nothing else, once it is
# on main: the Worker below always reads main, so a branch's README preview
# shows a button that exists only on that branch as a broken image.
#
# Its images come from buttons.halleluja.design, not straight from this
# repository. Every <img> runs its animation on its own clock, started when that
# one image arrived, and on a first visit the images of one row arrived up to
# 1.2 s apart, so the band jumped between buttons instead of travelling. That
# Worker serves these same files with the delay rewritten against the wall clock
# at the moment it answers, which puts every image on one schedule however late
# it loads. It serves any file in .github/assets/download-buttons/ of any
# junkerderprovinz repository, so a new button needs no change there. Source and
# measurements: junkerderprovinz/junkerderprovinz, donate/worker/.
REPO = "arrowloop"
BUTTON_HOST = "https://buttons.halleluja.design"
README = os.path.join(HERE, "..", "README.md")
ROW_OPEN = "<!-- download-buttons: written by scripts/gen_download_buttons.py -->"
ROW_CLOSE = "<!-- /download-buttons -->"


def brand(name):
    """One mark: its path, and the scale and offset that centre it in GLYPH."""
    path = io.open(os.path.join(BRANDS, name + ".txt"), encoding="utf-8").read().strip()
    box = io.open(os.path.join(BRANDS, name + ".box.txt"), encoding="utf-8").read().strip()
    _, _, width, height = (float(n) for n in box.split())
    # Scaled by HEIGHT so the three marks share an optical size, then nudged
    # right by half the width they do not use. Apple's mark is narrower than the
    # other two, and without this it would sit left of them in the row.
    scale = GLYPH / height
    return path, scale, (GLYPH - width * scale) / 2


def read_readme():
    """README.md and where its row sits, checked before anything is written.

    Checked first, so a README without its markers stops the run while the
    buttons are still untouched, instead of leaving them and the row out of
    step. REPO is checked against the links for the same reason: copied into
    another repository and left unchanged, it would quietly show this
    repository's buttons there.
    """
    text = io.open(README, encoding="utf-8", newline="").read()
    start = text.find(ROW_OPEN)
    end = text.find(ROW_CLOSE, start) if start >= 0 else -1
    if end < 0:
        raise SystemExit("README.md has no %s ... %s around the button row" % (ROW_OPEN, ROW_CLOSE))
    for slug, *_, href in BUTTONS:
        if "/%s/" % REPO not in href:
            raise SystemExit("REPO is %r, but %s leads to %s" % (REPO, slug, href))
    return text, start, end


def write_readme(text, start, end):
    """Replace the row between the markers.

    The separator stands on its own line, two spaces in, because that is the
    gap GAP_PX was measured on. The width is RENDER_PX for the same reason. The
    row takes the line ending of its own marker line.
    """
    nl = "\r\n" if text[start:].split("\n", 1)[0].endswith("\r") else "\n"
    row = [ROW_OPEN, '<p align="center">']
    for index, (slug, *_, alt, href) in enumerate(BUTTONS):
        if index:
            row.append("  &nbsp;")
        row.append('  <a href="%s"><img src="%s/%s/button-%s.svg" alt="%s" width="%g"></a>'
                   % (escape(href), BUTTON_HOST, REPO, slug, escape(alt), RENDER_PX))
    row.append("</p>")
    io.open(README, "w", encoding="utf-8", newline="").write(text[:start] + nl.join(row) + nl + text[end:])
    print("wrote", os.path.normpath(README), "row of", len(BUTTONS))


# The delay is the button's POSITION times STEP, computed here rather than
# written into the table above: a hand-kept column of seconds is a column
# somebody reorders the row without touching, and then the band hands off into
# nothing.
#
# THIS ROW STARTS AFTER THE GIVE ROW, because in this README the give row stands
# ABOVE it. One band works its way down the page, the whole first row and then
# the whole second, and the give row cannot move to make room: its three buttons
# are one shared asset referenced by every README in the house, with a fixed
# place in the loop (3.8 s in, then one step per button at their own rendered
# width of 160px plus the same measured gap). So this row takes the slot a
# fourth give button would have had, and what is left of the seven seconds is
# the pause before the band comes back to the top. Starting at zero instead, as
# a row that stands first on its page does, ran the band up the page here.
GIVE_START = 3.8
GIVE_STEP = (160.0 + GAP_PX) / SPEED
ROW_START = GIVE_START + 3 * GIVE_STEP

readme = read_readme()
os.makedirs(OUT, exist_ok=True)
for index, (slug, mark, bg, ink, head, sub_text, alt, _href) in enumerate(BUTTONS):
    path, scale, inset = brand(mark)
    svg = TEMPLATE.format(
        w=W, h=H, r=R, bg=bg, ink=ink, gx=round(GX + inset, 2), gy=round(GY, 2),
        scale=round(scale, 5), path=path, font=FONT,
        head=head, sub_text=sub_text, alt=escape(alt),
        delay="%.3f" % ((ROW_START + STEP * index) % CYCLE), cycle="%g" % CYCLE,
        pass_pct="%.2f" % PASS_PCT, band_w="%.1f" % SHEEN_W,
        band_h="%g" % SHEEN_H, band_start="%.1f" % SHEEN_FROM,
        band_end="%.1f" % SHEEN_TO,
    )
    out = os.path.join(OUT, "button-" + slug + ".svg")
    io.open(out, "w", encoding="utf-8", newline="\n").write(svg)
    print("wrote", os.path.normpath(out), len(svg), "bytes")
write_readme(*readme)
