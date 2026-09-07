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

    # The direction of a job, drawn rather than described. Three glyphs, so the
    # setting reads at a glance from the list without opening anything.
    ("IconToRight", "interface-essential/move-right.svg", "Left to right only"),
    ("IconToLeft", "interface-essential/move-left.svg", "Right to left only"),

    # Folders, the picker, and saving.
    ("IconFolder", "interface-essential/new-folder.svg", "Pick a folder. The plain shape: the local-storage one carries a drive motif and reads as a monitor at fourteen pixels"),
    ("IconNewFolder", "interface-essential/folder-add.svg", "Make a folder here"),
    ("IconUp", "interface-essential/move-left.svg", "One level up, in the folder picker"),
    ("IconSave", "computer-devices/floppy-disk.svg", "Save"),
    ("IconCancel", "interface-essential/delete-1.svg", "Cancel, on a dialog's own footer"),
    ("IconConfirm", "interface-essential/check.svg", "Confirm. NOT IconCheck, which is the magnifying glass this app uses for \"open a target and look at it\""),

    # The reveal eye on a field holding a secret, and its slashed twin.
    ("IconVisible", "interface-essential/visible.svg", "Show a stored secret"),
    ("IconHidden", "interface-essential/invisible-1.svg", "Hide it again"),
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
    ("IconBothWays",
     "Both ways: the same two arrows the one-way settings use, one above the "
     "other. It used to be the reload loop, which draws hooks instead of "
     "arrowheads and reads as retry rather than as two directions",
     [("interface-essential/move-right.svg", "translate(0 -2.4) scale(1 0.6)"),
      ("interface-essential/move-left.svg", "translate(0 8.2) scale(1 0.6)")]),

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
//
// Every glyph here comes from that one set, drawn on one 14-unit grid with one
// convention, which is why none of them needs the measured ink-crop the design
// language describes for apps that mix sets.

import type { SVGProps } from 'react'

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
'''


def paths_of(svg: str):
    """Every path's d attribute, in document order."""
    return re.findall(r'<path[^>]*\sd="([^"]+)"', svg)


def box_of(svg: str) -> str:
    found = re.search(r'viewBox="([^"]+)"', svg)
    if not found:
        raise SystemExit("no viewBox")
    return found.group(1)


def main() -> None:
    out = [HEADER]
    for name, rel, note in GLYPHS:
        full = os.path.join(SRC, rel)
        if not os.path.exists(full):
            raise SystemExit("missing source glyph: %s" % full)
        svg = io.open(full, encoding="utf-8").read()
        paths = paths_of(svg)
        if not paths:
            raise SystemExit("no paths in %s" % rel)
        joined = ", ".join("'%s'" % p.replace("\\", "\\\\").replace("'", "\\'") for p in paths)
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
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write("".join(out))
    print("wrote %s with %d glyphs" % (OUT, len(GLYPHS) + len(COMPOSED)))


if __name__ == "__main__":
    main()
