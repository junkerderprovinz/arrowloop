"""Generate ArrowLoop's icon set from Streamline's free Core Solid subset.

Run from the repository root:
    python scripts/gen_glyphs.py <path to streamline-vectors/core/solid>

Source: github.com/webalys-hq/streamline-vectors, folder core/solid, CC BY 4.0,
the free 1000-icon subset whose licence permits redistribution. The premium set
sold on streamlinehq.com forbids what a public repository does and cannot be
used here.

Every icon in the set is drawn on one 14-unit grid with one convention, so the
source viewBox is carried through unchanged. A glyph from anywhere else needs a
measured ink crop first (see LICENSED below and scripts/measure_ink.py).

Writes web/src/components/glyphs.tsx, which is generated: a hand edit is lost on
the next run.
"""

import io
import os
import re
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/slv/core/solid"
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "src", "components", "glyphs.tsx")

# our name -> (file under core/solid, what it means here[, transform])
GLYPHS = [
    # Navigation.
    ("IconJobs", "interface-essential/arrow-reload-horizontal-1.svg",
     "Jobs: two arrows, one each way, which is the whole product"),
    ("IconEdit", "interface-essential/pencil.svg", "Edit"),
    ("IconTargets", "computer-devices/database-server-1.svg", "Storage targets and drives"),
    ("IconHistory", "interface-essential/bullet-list.svg", "What the runs did"),
    ("IconLook", "interface-essential/color-palette.svg", "Theme, shape, accent, language"),
    ("IconSettings", "interface-essential/cog.svg", "Settings, the last tab as in every other app here"),
    ("IconAbout", "interface-essential/information-circle.svg",
     "The About section, on the settings tab strip"),

    # Row actions: small, secondary, icon-only.
    ("IconAdd", "interface-essential/add-1.svg", "Add a job, from the list it appears in"),
    ("IconLive", "interface-essential/dashboard-3.svg", "What is happening right now"),
    ("IconReset", "interface-essential/arrow-round-left.svg",
     "Put a colour back to the house default. A small reset badge carries a glyph, never a word"),
    ("IconCheck", "interface-essential/magnifying-glass.svg", "Open a target and look at it"),
    ("IconDelete", "interface-essential/recycle-bin-2.svg", "Delete"),
    ("IconCopy", "interface-essential/copy-paste.svg", "Copy to the clipboard"),
    ("IconForget", "interface-essential/subtract-circle.svg", "Forget a drive, leaving its marker"),
    ("IconPreview", "interface-essential/visible.svg", "See what a run would do"),

    # Two verbs on a job's card: start a run now, and switch the schedule off.
    ("IconRun", "entertainment/button-play.svg", "Start this job now, by hand"),
    ("IconPause", "entertainment/button-pause-2.svg", "Hold this job's schedule"),

    # The direction of a job: one bare arrow, turned. move-right.svg and
    # move-left.svg draw a bar behind the head, which reads as "move to the end".
    ("IconToRight", "interface-essential/arrow-up-1.svg", "Left to right only",
     "rotate(90 7 7)"),
    ("IconToLeft", "interface-essential/arrow-up-1.svg", "Right to left only",
     "rotate(-90 7 7)"),

    # The two sides of a job. The cloud side draws the provider's own brand
    # mark, so only the device needs one here.
    ("IconThisDevice", "phone/phone-mobile-phone.svg",
     "The side of a job that is a folder on this phone"),
    # Folders, the picker, and saving.
    ("IconFolder", "interface-essential/new-folder.svg", "Pick a folder. The plain shape: the local-storage one carries a drive motif and reads as a monitor at fourteen pixels"),
    ("IconNewFolder", "interface-essential/folder-add.svg", "Make a folder here"),
    # The bare arrow again: the bar in move-left.svg reads as "jump to the
    # start".
    ("IconUp", "interface-essential/arrow-up-1.svg", "One level up, in the folder picker",
     "rotate(-90 7 7)"),
    # IconSave comes from outside Streamline and lives in LICENSED below.

    # The reveal eye on a field holding a secret, and its slashed twin.
    ("IconVisible", "interface-essential/visible.svg", "Show a stored secret"),
    ("IconHidden", "interface-essential/invisible-1.svg", "Hide it again"),

    ("IconLock", "interface-essential/padlock-square-1.svg",
     "A target that encrypts what is written into it"),

    # Three protocols, three drawings: a machine, a transfer, a store.
    ("IconServer", "computer-devices/database-server-2.svg", "SFTP: a machine reached over SSH"),
    ("IconTransfer", "interface-essential/arrow-transfer-diagonal-1.svg",
     "FTP: the protocol whose whole name is the transfer"),
    ("IconBuckets", "computer-devices/database.svg", "S3: object storage, which is buckets"),

    # One box with the arrow reversed, the same pair the sibling app uses.
    ("IconDownload", "interface-essential/download-box-1.svg", "Export the setup to a file"),
    ("IconUpload", "interface-essential/upload-box-1.svg", "Read a setup back in from a file"),

    # The buttons on GlimStone's AboutCard; main.tsx maps its label keys here.
    ("IconCoffee", "food-drink/coffee-mug.svg", "Buy the author a coffee"),
    ("IconLink", "interface-essential/link-chain.svg", "Open the repository"),
    ("IconMail", "mail/mail-send-envelope.svg", "Write to the author"),
    # A wallet rather than a coin: the window behind this button offers five
    # chains, and a Bitcoin symbol would name only one.
    ("IconWallet", "money-shopping/wallet.svg", "Give with crypto"),
]

# Glyphs composed from this set. Every part is on the same grid, so they need no
# measuring either.
#
# name -> (note, [(source file, transform), ...])
COMPOSED = [
    # A transform list applies right to left: the uniform scale first, in the
    # arrow's upright frame, then the translate, then the rotation.
    #
    #   scale(0.6)          x 3..11 -> 1.8..6.6      y 0..14 -> 0..8.4
    #   translate(-0.7 2.8) x       -> 1.1..5.9      y       -> 2.8..11.2
    #   rotate(90 7 7)      (x,y) -> (14-y, x)  = x' 2.8..11.2, y' 1.1..5.9
    #   rotate(-90 7 7)     (x,y) -> (y, 14-x) = x' 2.8..11.2, y' 8.1..12.9
    #
    # Both arrows span the same horizontal run, centred on y=3.5 and y=10.5,
    # symmetric about the middle and inside the 0..14 viewBox.
    ("IconBothWays",
     "Both ways: the one-way arrows, one above the other and pointing opposite "
     "ways",
     [("interface-essential/arrow-up-1.svg", "rotate(90 7 7) translate(-0.7 2.8) scale(0.6)"),
      ("interface-essential/arrow-up-1.svg", "rotate(-90 7 7) translate(-0.7 2.8) scale(0.6)")]),

]

# Glyphs drawn here, because the set's diagonal marks look larger than the round
# glyphs beside them.
#
# Reach, the distance from the centre to the furthest ink, is what the eye reads
# as size. A cross puts its tips on the corners of its box, so filling the same
# box as a round glyph makes it reach sqrt(2) further: delete-1.svg reaches 9.49
# and check.svg 8.82, against 7.0 for a frame-filling round glyph. The cross is
# BombVault's settled geometry, and the check is drawn to the same rule.
#
# name -> (note, box, markup)
DRAWN = [
    ("IconCancel",
     "Cancel, on a dialog's own footer. A plus turned 45 degrees, which is one "
     "drawing rather than two that could drift apart",
     # Tip radius 5 lands the tips where a frame-filling round glyph puts its
     # outermost ink. The bars are 2.2 rather than the upright plus's 2.8
     # because the mark shrank by 1/sqrt(2) and painted area goes with its
     # square.
     "2 2 10 10",
     '<g transform="rotate(45 7 7)">'
     '<rect x="2" y="5.9" width="10" height="2.2" rx="1.1" />'
     '<rect x="5.9" y="2" width="2.2" height="10" rx="1.1" />'
     '</g>'),

    ("IconConfirm",
     "Confirm. Not IconCheck, which is the magnifying glass this app uses for "
     "\"open a target and look at it\"",
     # The long tip at (11.6, 3.4) is 5.84 from the centre, plus the 1.1 cap
     # radius makes 6.94 against the round glyphs' 7.0. Stroked, so the bar
     # holds the cross's 2.2 thickness, with round caps for the same ends.
     "0 0 14 14",
     '<path d="M2.4 7.4L5.6 10.9L11.6 3.4" fill="none" stroke="currentColor"'
     ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />'),
]

# Glyphs from outside Streamline: name, note, source line, the measured box, and
# the paths verbatim.
#
# The box is the drawing's own ink, squared off and centred. The source declares
# `0 0 492 492` and the ink occupies 368.7 of it, so the declared box would
# render the mark at three quarters the size of its neighbours. Re-measure with
# scripts/measure_ink.py if the artwork is replaced.
LICENSED = [
    ("IconSave",
     "Save",
     "Vecteezy (https://www.vecteezy.com), Free License, attribution required",
     "61.80 62.40 368.70 368.70",
     [
         "M267.8,79.6v86.4c0,1.7.7,3.2,1.8,4.3,1.1,1.1,2.6,1.8,4.3,1.8h34.4c1.7,0,3.2-.7,4.3-1.8,"
         "1.1-1.1,1.8-2.6,1.8-4.3v-86.4c0-1.7-.7-3.2-1.8-4.3-1.1-1.1-2.6-1.8-4.3-1.8h-34.4c-1.7,0-3.2.7-4.3,"
         "1.8-1.1,1.1-1.8,2.6-1.8,4.3Z",
         "M77.3,431.1h337.8c8.5,0,15.4-6.9,15.4-15.4V108.7l-46.3-46.3h-51.8v120.7h-172.5V62.4h-82.7c-8.5,"
         "0-15.4,6.9-15.4,15.4v337.8c0,8.5,6.9,15.4,15.4,15.4h0ZM152.1,265.2h188.4c7.8,0,14.1,6.4,14.1,"
         "14.1v108.4c0,7.8-6.4,14.1-14.1,14.1h-188.4c-7.8,0-14.1-6.4-14.1-14.1v-108.4c0-7.8,6.4-14.1,14.1-14.1Z",
     ]),
]

HEADER = '''// ArrowLoop's icon set.
//
// GENERATED by scripts/gen_glyphs.py. Do not hand-edit: regenerate instead, or
// the next run silently discards the change.
//
// Attribution, required by the licence:
//   Free icons from Streamline, https://streamlinehq.com (CC BY 4.0)
//   The free 1000-icon Core Solid subset only:
//   https://github.com/webalys-hq/streamline-vectors
//   IconSave from Vecteezy, https://www.vecteezy.com
//
// The Streamline glyphs share one 14-unit grid, so they keep their own
// viewBox; IconSave carries a measured crop.

import type { ReactNode, SVGProps } from 'react'

/** Two or more glyphs from the same set, stacked into one drawing, each group
 *  with its own transform. */
function Stack({ box, groups, ...rest }: { box: string; groups: { transform: string; paths: string[] }[] } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox={box}
      fill="currentColor"
      className="shrink-0"
      aria-hidden="true"
      {...rest}
    >
      {groups.map((g) => (
        <g key={g.transform} transform={g.transform}>
          {g.paths.map((one) => (
            <path key={one} fillRule="evenodd" clipRule="evenodd" d={one} />
          ))}
        </g>
      ))}
    </svg>
  )
}

/** One glyph, sized by the caller and coloured by currentColor. */
function Glyph({ box, paths, ...rest }: { box: string; paths: string[] } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox={box}
      fill="currentColor"
      className="shrink-0"
      aria-hidden="true"
      {...rest}
    >
      {paths.map((one) => (
        <path key={one} fillRule="evenodd" clipRule="evenodd" d={one} />
      ))}
    </svg>
  )
}

/** A mark drawn to match the set's size; see the DRAWN table in
 *  scripts/gen_glyphs.py. */
function Drawn({ box, children, ...rest }: { box: string; children: ReactNode } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox={box}
      fill="currentColor"
      className="shrink-0"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}
'''


def paths_of(svg: str):
    """Every path's d attribute, in document order."""
    return re.findall(r'<path[^>]*\sd="([^"]+)"', svg)


def jsx(markup: str) -> str:
    """SVG markup as JSX: hyphenated attributes become camelCase.

    An attribute left hyphenated is an error, since React would drop it
    silently and ship a glyph missing its stroke.
    """
    known = {
        "stroke-width": "strokeWidth",
        "stroke-linecap": "strokeLinecap",
        "stroke-linejoin": "strokeLinejoin",
        "fill-rule": "fillRule",
        "clip-rule": "clipRule",
    }
    for was, now in known.items():
        markup = markup.replace(was + "=", now + "=")
    left = re.findall(r'\s([a-z]+-[a-z-]+)=', markup)
    if left:
        raise SystemExit("untranslated SVG attribute(s) in a DRAWN glyph: %s" % ", ".join(left))
    return markup


def box_of(svg: str) -> str:
    found = re.search(r'viewBox="([^"]+)"', svg)
    if not found:
        raise SystemExit("no viewBox")
    return found.group(1)


def main() -> None:
    out = [HEADER]
    for entry in GLYPHS:
        # An optional fourth field turns the drawing.
        name, rel, note = entry[0], entry[1], entry[2]
        transform = entry[3] if len(entry) > 3 else None
        full = os.path.join(SRC, rel)
        if not os.path.exists(full):
            raise SystemExit("missing source glyph: %s" % full)
        svg = io.open(full, encoding="utf-8").read()
        paths = paths_of(svg)
        if not paths:
            raise SystemExit("no paths in %s" % rel)
        joined = ", ".join("'%s'" % p.replace("\\", "\\\\").replace("'", "\\'") for p in paths)
        if transform:
            out.append(
                "\n/** %s. Streamline: %s, turned */\n"
                "export function %s(props: SVGProps<SVGSVGElement>) {\n"
                "  return <Stack box=\"%s\" groups={[{ transform: '%s', paths: [%s] }]} {...props} />\n"
                "}\n" % (note, rel, name, box_of(svg), transform, joined)
            )
            continue
        out.append(
            "\n/** %s. Streamline: %s */\n"
            "export function %s(props: SVGProps<SVGSVGElement>) {\n"
            "  return <Glyph box=\"%s\" paths={[%s]} {...props} />\n"
            "}\n" % (note, rel, name, box_of(svg), joined)
        )
    for name, note, parts in COMPOSED:
        groups = []
        sources = []
        for rel, transform in parts:
            full = os.path.join(SRC, rel)
            if not os.path.exists(full):
                raise SystemExit("missing source glyph: %s" % full)
            svg = io.open(full, encoding="utf-8").read()
            paths = paths_of(svg)
            if not paths:
                raise SystemExit("no paths in %s" % rel)
            joined = ", ".join(
                "'%s'" % q.replace(chr(92), chr(92) * 2).replace("'", chr(92) + "'")
                for q in paths)
            groups.append("{ transform: '%s', paths: [%s] }" % (transform, joined))
            sources.append(rel)
        out.append(
            "\n/** %s. Streamline: %s */\n"
            "export function %s(props: SVGProps<SVGSVGElement>) {\n"
            "  return <Stack box=\"0 0 14 14\" groups={[%s]} {...props} />\n"
            "}\n" % (note, " + ".join(sources), name, ", ".join(groups))
        )
    for name, note, box, markup in DRAWN:
        out.append(
            "\n/** %s. Drawn here, see gen_glyphs.py's DRAWN table for why */\n"
            "export function %s(props: SVGProps<SVGSVGElement>) {\n"
            "  return (\n"
            "    <Drawn box=\"%s\" {...props}>\n"
            "      %s\n"
            "    </Drawn>\n"
            "  )\n"
            "}\n" % (note, name, box, jsx(markup))
        )
    for name, note, source, box, paths in LICENSED:
        joined = ", ".join("'%s'" % p.replace("\\", "\\\\").replace("'", "\\'") for p in paths)
        out.append(
            "\n/** %s. %s */\n"
            "export function %s(props: SVGProps<SVGSVGElement>) {\n"
            "  return <Glyph box=\"%s\" paths={[%s]} {...props} />\n"
            "}\n" % (note, source, name, box, joined)
        )
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write("".join(out))
    print(
        "wrote %s with %d glyphs"
        % (OUT, len(GLYPHS) + len(COMPOSED) + len(DRAWN) + len(LICENSED))
    )


if __name__ == "__main__":
    main()
