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
Writes .github/assets/download-buttons/*.svg, which are committed.
"""

import io
import math
import os

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

# slug, brand file, background, ink, heading, second line, accessible name
BUTTONS = [
    ("windows-installer", "windows", "#0078d4", "#ffffff", "Windows", "Installer", "Download for Windows, installer"),
    ("windows-portable", "windows", "#0078d4", "#ffffff", "Windows", "Portable", "Download for Windows, portable"),
    # Apple's own space grey. Black is the usual answer and the wrong one here:
    # with no outline it vanishes against GitHub's dark theme.
    ("macos", "apple", "#6e6e73", "#ffffff", "macOS", "Universal", "Download for macOS"),
    # The yellow Tux is drawn in, dark ink on it for the same reason road signs
    # do that.
    ("linux", "linux", "#fcc624", "#1b1b1b", "Linux", "amd64", "Download for Linux"),
]


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


os.makedirs(OUT, exist_ok=True)
# The delay is the button's POSITION times STEP, computed here rather than
# written into the table above: a hand-kept column of seconds is a column
# somebody reorders the row without touching, and then the band hands off into
# nothing.
for index, (slug, mark, bg, ink, head, sub_text, alt) in enumerate(BUTTONS):
    path, scale, inset = brand(mark)
    svg = TEMPLATE.format(
        w=W, h=H, r=R, bg=bg, ink=ink, gx=round(GX + inset, 2), gy=round(GY, 2),
        scale=round(scale, 5), path=path, font=FONT,
        head=head, sub_text=sub_text, alt=alt,
        delay="%.3f" % (STEP * index), cycle="%g" % CYCLE,
        pass_pct="%.2f" % PASS_PCT, band_w="%.1f" % SHEEN_W,
        band_h="%g" % SHEEN_H, band_start="%.1f" % SHEEN_FROM,
        band_end="%.1f" % SHEEN_TO,
    )
    out = os.path.join(OUT, "button-" + slug + ".svg")
    io.open(out, "w", encoding="utf-8", newline="\n").write(svg)
    print("wrote", os.path.normpath(out), len(svg), "bytes")
