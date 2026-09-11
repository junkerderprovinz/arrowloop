# -*- coding: utf-8 -*-
"""The drawn extent of an SVG path, measured rather than guessed.

GlimStone's rule 2: a path's drawn extent and its viewBox have no necessary
relationship, so a glyph from a new source has to be MEASURED before it can be
cropped to match the set it is joining. `getBBox()` in a browser is the tool the
reference names; this is the same number without one, by flattening every curve
and taking the extremes of the points.

Only the commands these two paths use are implemented, and anything else raises
rather than being skipped: a command silently ignored is a corner of the drawing
missing from the measurement, which would crop the glyph through its own ink.
"""

import re
import sys

NUM = re.compile(r"-?\d*\.?\d+(?:[eE][-+]?\d+)?")
CMD = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])")


def bezier(p0, p1, p2, p3, steps=64):
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return out


def points(d: str):
    out = []
    x = y = 0.0
    start = (0.0, 0.0)
    prev_c2 = None
    parts = [p for p in CMD.split(d) if p.strip()]
    i = 0
    while i < len(parts):
        cmd = parts[i]
        i += 1
        args = [float(n) for n in NUM.findall(parts[i])] if i < len(parts) and not CMD.fullmatch(parts[i]) else []
        if args:
            i += 1

        if cmd in "Zz":
            x, y = start
            out.append((x, y))
            continue

        step = {"M": 2, "m": 2, "L": 2, "l": 2, "H": 1, "h": 1, "V": 1, "v": 1, "C": 6, "c": 6}.get(cmd)
        if step is None:
            raise SystemExit("measure_ink: command %r is not handled" % cmd)

        first = True
        for k in range(0, len(args), step):
            chunk = args[k:k + step]
            if cmd in "Mm":
                x = chunk[0] if cmd == "M" else x + chunk[0]
                y = chunk[1] if cmd == "M" else y + chunk[1]
                if first:
                    start = (x, y)
                # A second pair after an M is an implicit lineto, which is what
                # the loop does anyway.
            elif cmd in "Ll":
                x = chunk[0] if cmd == "L" else x + chunk[0]
                y = chunk[1] if cmd == "L" else y + chunk[1]
            elif cmd in "Hh":
                x = chunk[0] if cmd == "H" else x + chunk[0]
            elif cmd in "Vv":
                y = chunk[0] if cmd == "V" else y + chunk[0]
            elif cmd in "Cc":
                if cmd == "C":
                    c1, c2, end = (chunk[0], chunk[1]), (chunk[2], chunk[3]), (chunk[4], chunk[5])
                else:
                    c1 = (x + chunk[0], y + chunk[1])
                    c2 = (x + chunk[2], y + chunk[3])
                    end = (x + chunk[4], y + chunk[5])
                out.extend(bezier((x, y), c1, c2, end, 32))
                x, y = end
            out.append((x, y))
            first = False
    return out


def main() -> None:
    svg = open(sys.argv[1], encoding="utf-8").read()
    xs, ys = [], []
    for d in re.findall(r'\sd="([^"]+)"', svg):
        for px, py in points(d):
            xs.append(px)
            ys.append(py)
    if not xs:
        raise SystemExit("measure_ink: no paths found")

    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = x1 - x0, y1 - y0
    side = max(w, h)
    # Squared off and centred, which is rule 3: the crop changes the BOX, never
    # a coordinate, so the drawing that survived review survives this too.
    cx, cy = x0 - (side - w) / 2, y0 - (side - h) / 2
    print("ink  x %.2f..%.2f  y %.2f..%.2f  (%.2f x %.2f)" % (x0, x1, y0, y1, w, h))
    box = re.search(r'viewBox="([^"]+)"', svg)
    print("declared viewBox:", box.group(1) if box else "none")
    print('cropped box: "%.2f %.2f %.2f %.2f"' % (cx, cy, side, side))


main()
