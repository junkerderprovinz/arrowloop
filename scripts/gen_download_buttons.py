"""Generate the README's four download buttons from one template.

From a template, because four hand-drawn buttons are four chances to type one
number differently, and the whole point of a row of them is that they look like
one control repeated.

The geometry: the height and the corner radius are the Buy Me a Coffee button's
own (245.3 tall, rx 38.2), so a download button and the coffee button rendered
at the same width stand the same height. The WIDTH is 720 rather than that
button's 841.9, measured on screen rather than guessed: at 841.9 a third of the
face sat empty to the right of the longest word and the button read as
lopsided.

The colour: GitHub's own button grey with a lighter edge. A near-black button
disappears against GitHub's dark theme, a yellow one would read as a second
coffee button, and a platform logo would be somebody else's trademark in a repo
that ships under AGPL. So the button carries a word, an arrow and an edge.

The arrow is the same one the interface uses for "export": Streamline's
interface-essential/download-box-1, drawn on a 14-unit grid, from the free Core
Solid subset (CC BY 4.0).

Run from anywhere:  python scripts/gen_download_buttons.py
Writes .github/assets/download-buttons/*.svg, which are committed.
"""

import io
import os

# Relative to this file, so the generator works from any working directory and
# in any repo it is copied into.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "assets", "download-buttons")

W, H, R = 720.0, 245.3, 38.2
BG, EDGE, INK, SUB = "#24292f", "#57606a", "#ffffff", "#adbac7"

ARROW = (
    "M6.375 0H3.383A1.5 1.5 0 0 0 2.07 0.772L0.347 3.875h6.028V0ZM0 12.5V5.125h14V12.5a1.5 "
    "1.5 0 0 1 -1.5 1.5h-11A1.5 1.5 0 0 1 0 12.5Zm13.653 -8.625H7.625V0h2.992a1.5 1.5 0 0 1 "
    "1.312 0.772l1.724 3.103Zm-9.3 6.479 2.293 2.293a0.5 0.5 0 0 0 0.708 0l2.292 -2.293a0.5 "
    "0.5 0 0 0 -0.353 -0.854H8v-2a1 1 0 1 0 -2 0v2H4.707a0.5 0.5 0 0 0 -0.353 0.854Z"
)

# The glyph measures 14 units and is drawn at 112 pixels, inset from the left.
GLYPH = 112.0
GX, GY = 78.0, (H - GLYPH) / 2
SCALE = GLYPH / 14.0

# A system stack, because an SVG loaded through <img> cannot fetch a webfont:
# whatever is named here has to already be on the reader's machine. The layout
# leaves room to the right of the longest word for a face wider than the one
# this was measured with.
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{alt}">
  <title>{alt}</title>
  <rect x="1.5" y="1.5" width="{iw}" height="{ih}" rx="{r}" ry="{r}" fill="{bg}" stroke="{edge}" stroke-width="3"/>
  <g transform="translate({gx} {gy}) scale({scale})" fill="{ink}">
    <path fill-rule="evenodd" clip-rule="evenodd" d="{arrow}"/>
  </g>
  <text x="238" y="110" font-family="{font}" font-size="82" font-weight="700" fill="{ink}">{head}</text>
  <text x="240" y="180" font-family="{font}" font-size="50" font-weight="400" fill="{sub}">{sub_text}</text>
</svg>
"""

BUTTONS = [
    ("windows-installer", "Windows", "Installer", "Download for Windows, installer"),
    ("windows-portable", "Windows", "Portable", "Download for Windows, portable"),
    ("macos", "macOS", "Universal", "Download for macOS"),
    ("linux", "Linux", "amd64", "Download for Linux"),
]

os.makedirs(OUT, exist_ok=True)
for slug, head, sub_text, alt in BUTTONS:
    svg = TEMPLATE.format(
        w=W, h=H, iw=W - 3, ih=H - 3, r=R, bg=BG, edge=EDGE, ink=INK, sub=SUB,
        gx=GX, gy=GY, scale=round(SCALE, 4), arrow=ARROW, font=FONT,
        head=head, sub_text=sub_text, alt=alt,
    )
    path = os.path.join(OUT, "button-" + slug + ".svg")
    io.open(path, "w", encoding="utf-8", newline="\n").write(svg)
    print("wrote", os.path.normpath(path), len(svg), "bytes")
