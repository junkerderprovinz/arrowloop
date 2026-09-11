"""Generate ArrowLoop's icon set from Streamline's FREE Core Solid subset.

Run from the repository root:
    python scripts/gen_glyphs.py <path to streamline-vectors/core/solid>

Source: github.com/webalys-hq/streamline-vectors, folder core/solid, CC BY 4.0.
That is the free 1000-icon subset, whose licence permits redistribution. The
5771-icon set sold on streamlinehq.com is a DIFFERENT, PREMIUM product whose
licence forbids exactly what a public repository does; it must not be used here.

Why this set and nothing else. The design language's sizing rules exist because
MIXING sets produces four different ideas about how much of a viewBox a drawing
should occupy, and the fix for that is a measured, ink-cropped viewBox per
glyph, which needs a real browser to measure. Every icon here comes from one
set drawn on one 14-unit grid with one convention, so the problem the crop
solves does not arise: the source viewBox is carried through unchanged and the
glyphs agree because they were drawn to agree. The day this app needs a glyph
Streamline does not have is the day it also needs the measuring step, and the
comment above the table below says so at the place where somebody would add it.

Writes src/components/glyphs.tsx, which is GENERATED. Do not hand-edit it:
regenerate, or the next run silently discards the change.
"""

import io
import os
import re
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/slv/core/solid"
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "src", "components", "glyphs.tsx")

# our name -> (file under core/solid, what it means here)
#
# One source set only. Adding a glyph from anywhere else means adding the
# ink-measuring step this generator deliberately does not have; see the module
# docstring before reaching for a second set.
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

    # Row actions. Small, secondary, icon-only: the design language's rule 13.
    ("IconAdd", "interface-essential/add-1.svg", "Add a job, from the list it appears in"),
    ("IconLive", "interface-essential/dashboard-3.svg", "What is happening right now"),
    ("IconReset", "interface-essential/arrow-round-left.svg",
     "Put a colour back to the house default. A small reset badge carries a glyph, never a word"),
    ("IconCheck", "interface-essential/magnifying-glass.svg", "Open a target and look at it"),
    ("IconDelete", "interface-essential/recycle-bin-2.svg", "Delete"),
    ("IconCopy", "interface-essential/copy-paste.svg", "Copy to the clipboard"),
    ("IconForget", "interface-essential/subtract-circle.svg", "Forget a drive, leaving its marker"),
    ("IconPreview", "interface-essential/visible.svg", "See what a run would do"),

    # Start and hold, on a job's own card. Two glyphs for two different verbs:
    # one starts a run NOW, the other switches the job's schedule off. They sit
    # side by side because that is where somebody looks for them, and they are
    # never the same button: a paused job that could still be started by hand is
    # not paused, and a running job that cannot be started again is not the
    # same as one that is switched off.
    ("IconRun", "entertainment/button-play.svg", "Start this job now, by hand"),
    ("IconPause", "entertainment/button-pause-2.svg", "Hold this job's schedule"),

    # The direction of a job, drawn rather than described. Three glyphs, so the
    # setting reads at a glance from the list without opening anything.
    #
    # ONE source arrow, turned. move-right.svg and move-left.svg draw a bar
    # behind the arrowhead, which is the "move to the end" keyboard idea and not
    # the direction of a job; jdp: "der richtungsbutton soll pfeile ohne balken
    # haben". arrow-up-1.svg is the same set's bare arrow, and turning the one
    # drawing beats picking two, because a matched pair cannot drift apart if
    # there is only one of them.
    ("IconToRight", "interface-essential/arrow-up-1.svg", "Left to right only",
     "rotate(90 7 7)"),
    ("IconToLeft", "interface-essential/arrow-up-1.svg", "Right to left only",
     "rotate(-90 7 7)"),

    # Folders, the picker, and saving.
    ("IconFolder", "interface-essential/new-folder.svg", "Pick a folder. The plain shape: the local-storage one carries a drive motif and reads as a monitor at fourteen pixels"),
    ("IconNewFolder", "interface-essential/folder-add.svg", "Make a folder here"),
    # Same bare arrow as the direction glyphs, for the same reason: the bar in
    # move-left.svg reads as "jump to the start", not as "up one folder".
    ("IconUp", "interface-essential/arrow-up-1.svg", "One level up, in the folder picker",
     "rotate(-90 7 7)"),
    # IconSave is NOT here. It is the one glyph in this app from outside
    # Streamline, and it lives in LICENSED below with its measured crop.

    # The reveal eye on a field holding a secret, and its slashed twin.
    ("IconVisible", "interface-essential/visible.svg", "Show a stored secret"),
    ("IconHidden", "interface-essential/invisible-1.svg", "Hide it again"),

    # The encrypted target, which used to wear the slashed eye above. That eye
    # means "hidden from view on this screen" and says nothing about a target
    # that encrypts everything written into it - two different ideas that
    # happen to share a mood. jdp: "Das icon für encryptet soll ein schloss
    # icon sein." A padlock is what everybody already reads as encrypted.
    ("IconLock", "interface-essential/padlock-square-1.svg",
     "A target that encrypts what is written into it"),

    # The three protocols on the second card, which all wore the same server
    # glyph and therefore read as one thing offered three times. jdp: "kannst du
    # für FTP, SFTP und S3 unterschiedliche Icons verwenden". They are three
    # different ideas and the drawings say so: a machine, a transfer, a store.
    ("IconServer", "computer-devices/database-server-2.svg", "SFTP: a machine reached over SSH"),
    ("IconTransfer", "interface-essential/arrow-transfer-diagonal-1.svg",
     "FTP: the protocol whose whole name is the transfer"),
    ("IconBuckets", "computer-devices/database.svg", "S3: object storage, which is buckets"),

    # Writing the setup to a file and reading one back. ONE box with the arrow
    # reversed, which is what the set already draws: a matched pair cannot drift
    # apart when it is the same silhouette twice. Same two files the sibling app
    # uses for the identical pair, so the two programs say "export" with the same
    # picture.
    ("IconDownload", "interface-essential/download-box-1.svg", "Export the setup to a file"),
    ("IconUpload", "interface-essential/upload-box-1.svg", "Read a setup back in from a file"),

    # The three buttons on the About card. They had no glyphs at all, and that
    # was not a card that had been drawn by hand: it is GlimStone's own
    # AboutCard, byte for byte, and its three buttons pass label keys the app's
    # resolver had simply never been told about. jdp: "in der uebercard fehlen
    # die glyphen." The icons were the missing half, the wiring in main.tsx the
    # other.
    ("IconCoffee", "food-drink/coffee-mug.svg", "Buy the author a coffee"),
    ("IconLink", "interface-essential/link-chain.svg", "Open the repository"),
    ("IconMail", "mail/mail-send-envelope.svg", "Write to the author"),
    # The second way to give. A wallet rather than a coin and never a
    # brand mark: the window behind this button offers five chains, so
    # the Bitcoin symbol would name one of them and mislead about the
    # other four. A wallet is what a donor already has open.
    ("IconWallet", "money-shopping/wallet.svg", "Give with crypto"),
]

# Glyphs COMPOSED from this set rather than taken whole.
#
# Taking a drawing from a second source would mean adding the ink-measuring
# step this generator deliberately does not have (see the module docstring).
# Stacking two glyphs that are already here needs neither: both were drawn on
# the same 14-unit grid to the same convention, so the problem the measuring
# solves does not arise here either.
#
# name -> (note, [(source file, transform), ...])
COMPOSED = [
    # Two arrows, one above the other, pointing opposite ways. jdp asked for
    # exactly that shape ("das icon fuer in beide richtungen sollen zwei pfeile
    # untereinander in entgegengesetzte richtung sein"), and the first attempt
    # said it in words and drew something else.
    #
    # THE TRANSFORM LIST READS RIGHT TO LEFT, which is what went wrong. The old
    # pair was `rotate(90 7 7) translate(0 -2.4) scale(1 0.6)`: the scale
    # applies FIRST, in the arrow's own upright frame, so it squashed the arrow
    # along its LENGTH rather than across it, and the translate then pushed it
    # 2.4 units off the top of the box before the rotation turned that overrun
    # into an overrun off the right edge. Both groups also ended up with their
    # shafts in the same horizontal band, so the two arrows drew one broken bar
    # with clipped stubs instead of a stacked pair.
    #
    # The pair below is a UNIFORM scale, so the arrowhead is not distorted, and
    # the translate is worked out in the pre-rotation frame on purpose:
    #
    #   scale(0.6)          x 3..11 -> 1.8..6.6      y 0..14 -> 0..8.4
    #   translate(-0.7 2.8) x       -> 1.1..5.9      y       -> 2.8..11.2
    #   rotate(90 7 7)      (x,y) -> (14-y, x)  = x' 2.8..11.2, y' 1.1..5.9
    #   rotate(-90 7 7)     (x,y) -> (y, 14-x) = x' 2.8..11.2, y' 8.1..12.9
    #
    # So both arrows span the same horizontal run, one sits centred on y=3.5
    # and the other on y=10.5, they are symmetric about the middle of the box,
    # nothing leaves the 0..14 viewBox, and the first points right while the
    # second points left.
    ("IconBothWays",
     "Both ways: the same two arrows the one-way settings use, one above the "
     "other and pointing opposite ways. It used to be the reload loop, which "
     "draws hooks instead of arrowheads and reads as retry rather than as two "
     "directions",
     [("interface-essential/arrow-up-1.svg", "rotate(90 7 7) translate(-0.7 2.8) scale(0.6)"),
      ("interface-essential/arrow-up-1.svg", "rotate(-90 7 7) translate(-0.7 2.8) scale(0.6)")]),

]

# Glyphs DRAWN here rather than taken from the set, and the one reason that is
# allowed.
#
# jdp: "der x und haken glyph passt wieder nicht zu den anderen glyphen. das
# problem hatten wir schon in BV. dort wurde es gefixt." He is right on both
# counts, and the fix is not a smaller box.
#
# REACH is the distance from the centre to the furthest ink, and it is what the
# eye calls "size" for marks of different shape. A CROSS PUTS ITS FOUR TIPS ON
# THE CORNERS OF ITS BOUNDING BOX; a round glyph puts its ink on the edge
# midpoints. Fill the same box with both and the cross reaches sqrt(2) further.
# Measured on this set: delete-1.svg spans 0.29 to 13.71 on both axes, so its
# reach is 9.49 against the 7.0 of a frame-filling round glyph. check.svg puts
# its long tip at (13.64, 1.20), reach 8.82. Both are diagonal marks aimed at a
# corner, and both are the complaint.
#
# BombVault paid three rounds to learn this on ONE glyph, each round measuring
# something true that was not the complaint: extent, then area, then reach. The
# lesson written down there: A MEASUREMENT THAT AGREES WITH ITSELF IS NOT A
# FINDING. So the cross below is BombVault's settled geometry, carried over
# unchanged rather than re-derived, and the check is drawn to the same rule.
#
# Doing that means these two marks are NOT from Streamline, which the module
# docstring otherwise forbids. The exception is narrow and it is the point: the
# ink-measuring step exists for glyphs that must be made to agree with the set,
# and these are exactly two such glyphs. Everything else still comes from the
# one set untouched.
#
# name -> (note, box, markup)
DRAWN = [
    ("IconCancel",
     "Cancel, on a dialog's own footer. A plus turned 45 degrees, which is one "
     "drawing rather than two that could drift apart",
     # Tip radius 5 in a 10-unit box is half the box, which lands the four tips
     # exactly where a frame-filling round glyph puts its outermost ink. The
     # bars are 2.2 rather than the upright plus's 2.8 because the mark shrank
     # by 1/sqrt(2) and painted area goes with the square of that.
     "2 2 10 10",
     '<g transform="rotate(45 7 7)">'
     '<rect x="2" y="5.9" width="10" height="2.2" rx="1.1" />'
     '<rect x="5.9" y="2" width="2.2" height="10" rx="1.1" />'
     '</g>'),

    ("IconConfirm",
     "Confirm. NOT IconCheck, which is the magnifying glass this app uses for "
     "\"open a target and look at it\"",
     # Same rule, applied to a two-armed mark: the long tip sits at (11.6, 3.4),
     # which is 5.84 from the centre, plus the 1.1 cap radius makes 6.94 against
     # the round glyphs' 7.0. Stroked rather than filled, because a bar mark
     # whose thickness has to match the cross's is far easier to hold at 2.2
     # than a filled outline is, and round caps and joins give it the same ends
     # the cross's rounded rectangles have.
     "0 0 14 14",
     '<path d="M2.4 7.4L5.6 10.9L11.6 3.4" fill="none" stroke="currentColor"'
     ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />'),
]

# Glyphs from somewhere other than Streamline: name, note, source line, the
# MEASURED cropped box, and the paths verbatim.
#
# The module docstring says the day this app needs a glyph Streamline does not
# have is the day it also needs the measuring step. That day arrived: jdp picked
# a save mark and asked for it across every repo, so this is that step, done
# once and written down.
#
# The box is the drawing's own ink, squared off and centred, per the design
# language's rule 3 - measured, not read off the file. The source declares
# `0 0 492 492` and the ink occupies 368.7 of that, so carried through unchanged
# the mark would render at three quarters the size of every glyph beside it.
# Re-measure with scripts/measure_ink.py if the artwork is ever replaced.
LICENSED = [
    ("IconSave",
     "Save",
     "Vecteezy (https://www.vecteezy.com), Free License - attribution required",
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
//   Free icons from Streamline - https://streamlinehq.com (CC BY 4.0)
//   The FREE 1000-icon Core Solid subset only:
//   https://github.com/webalys-hq/streamline-vectors
//   IconSave from Vecteezy - https://www.vecteezy.com
//
// Nearly every glyph here comes from that one Streamline set, drawn on one
// 14-unit grid with one convention, which is why none of THOSE needs the
// measured ink-crop the design language describes for apps that mix sets. The
// one that comes from elsewhere carries its measured crop in the generator.

import type { ReactNode, SVGProps } from 'react'

/** Two or more glyphs from the same set, stacked into one drawing. Each group
 *  carries its own transform, so a composed glyph needs no second source set
 *  and no ink measuring: every part was drawn on this grid already. */
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

/** One glyph. Sized by the caller through width and height, coloured by
 *  currentColor so it follows whatever the surrounding text is doing. */
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

/** A mark drawn here rather than taken from the set, because it had to be made
 *  to agree with the set. See the DRAWN table in scripts/gen_glyphs.py for why
 *  exactly two glyphs are allowed to be here and what "agree" measures. */
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

    Only the attributes the DRAWN table actually uses are translated, and an
    untranslated hyphenated attribute is an error rather than a silent pass:
    React drops an unknown camelCase-shaped prop without a word, so a typo here
    would ship a glyph missing its stroke and nothing would say so.
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
        # A fourth field is an optional transform: the same drawing turned, so
        # a pair of opposite arrows stays one drawing rather than two.
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
