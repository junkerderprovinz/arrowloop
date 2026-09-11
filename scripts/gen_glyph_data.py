"""Turn the generated glyph components into data both bundlers can read.

`web/src/components/glyphs.tsx` and `brandGlyphs.tsx` are React: they return
`<svg>`, which Metro cannot render and React Native has no element for. The
drawings themselves are not React, though - they are path data - so this lifts
them out into `web/src/lib/glyphs.data.ts`, and the phone renders the same
paths through react-native-svg.

The same move the translation table and the schedule reader already made, and
for the same reason: ONE source. A second hand-kept icon set for the phone
would be right on the day it was written and quietly wrong a year later, which
on an icon set means a button wearing the mark of a different action.

It reads the GENERATED files rather than Streamline and Simple Icons, so it
needs neither source set installed and can be re-run any time. Run it after
gen_glyphs.py or gen_brand_glyphs.py; `glyphs.parity.test.ts` fails if you
forget.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLYPHS_TSX = ROOT / "web" / "src" / "components" / "glyphs.tsx"
BRANDS_TSX = ROOT / "web" / "src" / "components" / "brandGlyphs.tsx"
BRANDS_CSS = ROOT / "web" / "src" / "brandGlyphs.css"
OUT = ROOT / "web" / "src" / "lib" / "glyphs.data.ts"

# `paths={['a', 'b']}` - single-quoted strings with backslash escapes.
STRINGS = re.compile(r"'((?:[^'\\]|\\.)*)'")


def unquote(raw: str) -> str:
    return raw.replace("\\'", "'").replace("\\\\", "\\")


# ---------------------------------------------------------------------------
# The app's own set: one grid, one convention, no gradients.
# ---------------------------------------------------------------------------


def app_glyphs() -> dict[str, dict]:
    text = io.open(GLYPHS_TSX, encoding="utf-8").read()
    out: dict[str, dict] = {}

    for match in re.finditer(
        r"export function (Icon\w+)\(props[^)]*\) \{\s*return <Glyph box=\"([^\"]+)\" paths=\{\[(.*?)\]\}",
        text,
        re.S,
    ):
        name, box, body = match.groups()
        out[name] = {
            "box": box,
            "groups": [{"parts": [{"d": unquote(p)} for p in STRINGS.findall(body)]}],
        }

    for match in re.finditer(
        r"export function (Icon\w+)\(props[^)]*\) \{\s*return <Stack box=\"([^\"]+)\" groups=\{\[(.*?)\]\}\s*\{\.\.\.props\}",
        text,
        re.S,
    ):
        name, box, body = match.groups()
        groups = []
        for one in re.finditer(r"\{ transform: '([^']*)', paths: \[(.*?)\] \}", body, re.S):
            transform, paths = one.groups()
            groups.append(
                {"transform": transform, "parts": [{"d": unquote(p)} for p in STRINGS.findall(paths)]}
            )
        out[name] = {"box": box, "groups": groups}

    for match in re.finditer(
        r"export function (Icon\w+)\(props[^)]*\) \{\s*return \(\s*<Drawn box=\"([^\"]+)\"[^>]*>\s*(.*?)\s*</Drawn>",
        text,
        re.S,
    ):
        name, box, markup = match.groups()
        out[name] = {"box": box, "groups": drawn(markup)}

    return out


def drawn(markup: str) -> list[dict]:
    """The two marks drawn by hand: rounded bars in a rotated group, and one
    stroked polyline. Anything else raises rather than being dropped, because a
    glyph that vanishes silently is a button with no mark on it."""
    groups: list[dict] = []
    rest = markup

    for g in re.finditer(r'<g transform="([^"]*)">(.*?)</g>', markup, re.S):
        groups.append({"transform": g.group(1), "parts": shapes(g.group(2))})
        rest = rest.replace(g.group(0), "")

    loose = shapes(rest)
    if loose:
        groups.append({"parts": loose})
    if not groups:
        raise SystemExit("gen_glyph_data: nothing recognised in a Drawn glyph: %r" % markup[:120])
    return groups


def shapes(markup: str) -> list[dict]:
    out: list[dict] = []
    for rect in re.finditer(
        r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)" ?/>', markup
    ):
        x, y, w, h, rx = (float(v) for v in rect.groups())
        out.append({"rect": [x, y, w, h, rx]})
    for path in re.finditer(r"<path ([^>]*?)/>", markup, re.S):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', path.group(1)))
        if "d" not in attrs:
            continue
        one: dict = {"d": attrs["d"]}
        if attrs.get("fill") == "none":
            one["fill"] = "none"
        if "strokeWidth" in attrs:
            one["stroke"] = float(attrs["strokeWidth"])
        out.append(one)
    left = re.sub(r"<(rect|path)\b[^>]*/>", "", markup).strip()
    if left:
        raise SystemExit("gen_glyph_data: unhandled markup in a Drawn glyph: %r" % left[:120])
    return out


# ---------------------------------------------------------------------------
# The brand marks: somebody else's drawings, with gradients and theme colours.
# ---------------------------------------------------------------------------


def brand_colours() -> dict[str, dict[str, str]]:
    """`--brand-x-0` per theme, from the stylesheet the web reads them through.

    Two answers per name, because several marks carry a colour that cannot be
    read on one of the two grounds - a black wordmark on a dark page - and the
    stylesheet already holds the swap. A phone that took only the light answer
    would draw an invisible logo every evening.
    """
    text = io.open(BRANDS_CSS, encoding="utf-8").read()

    # Where `@media (prefers-color-scheme: light)` reaches. A declaration block
    # inside it is the light answer whatever its own selector says - and its
    # own selector says `:root:not([data-theme="dark"])`, which is why the
    # selector alone cannot be trusted: the innermost-block regex below never
    # sees the media query it sits in.
    light_spans: list[tuple[int, int]] = []
    for at in re.finditer(r"@media \(prefers-color-scheme: light\)", text):
        depth = 0
        i = text.index("{", at.end())
        start = i
        while i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        light_spans.append((start, i))

    def in_light(pos: int) -> bool:
        return any(a <= pos <= b for a, b in light_spans)

    out: dict[str, dict[str, str]] = {}
    for block in re.finditer(r"([^{}]*)\{([^{}]*)\}", text):
        selector, body = block.groups()
        if in_light(block.start()):
            for name, value in re.findall(r"(--brand-[\w-]+):\s*([^;]+);", body):
                out.setdefault(name, {})["light"] = value.strip()
            continue
        # A hover rule is not a theme's answer, it is a state's.
        if ":hover" in selector:
            continue
        # `:not([data-theme="dark"])` names dark in order to EXCLUDE it, and a
        # plain substring test reads that as "this block is the dark one" -
        # which is how every mark ended up with one colour for both themes.
        naked = re.sub(r":not\([^)]*\)", "", selector)
        if 'data-theme="light"' in naked:
            theme = "light"
        elif 'data-theme="dark"' in naked or ":root" in naked:
            # The stylesheet is dark-first: the bare `:root` block is grouped
            # with `[data-theme="dark"]` and carries the dark values.
            theme = "dark"
        else:
            continue
        for name, value in re.findall(r"(--brand-[\w-]+):\s*([^;]+);", body):
            out.setdefault(name, {})[theme] = value.strip()

    # A stylesheet that exists to say "this mark needs a different colour on a
    # dark page" and produces the same colour twice has been misread, and the
    # symptom is a logo nobody can see on one of the two grounds.
    swapped = sum(1 for pair in out.values() if pair.get("light") != pair.get("dark"))
    if swapped == 0:
        raise SystemExit("gen_glyph_data: no mark differs between the themes - the stylesheet was misread")
    return out


def brand_glyphs(colours: dict[str, dict[str, str]]) -> dict[str, dict]:
    text = io.open(BRANDS_TSX, encoding="utf-8").read()
    out: dict[str, dict] = {}
    for match in re.finditer(
        r"export function (Icon\w+)\(props[^)]*\) \{\s*return \(\s*(<svg .*?</svg>)\s*\)\s*\}",
        text,
        re.S,
    ):
        name, svg = match.groups()
        box = re.search(r'viewBox="([^"]+)"', svg)
        if not box:
            raise SystemExit("gen_glyph_data: %s has no viewBox" % name)
        out[name] = {
            "box": box.group(1),
            "fill": resolve(re.search(r'<svg[^>]*\bfill="([^"]+)"', svg), colours),
            "svg": inner(svg),
        }
    return out


def resolve(match, colours) -> dict[str, str] | str | None:
    """A colour, as the phone needs it: a literal, or one per theme."""
    if not match:
        return None
    value = match.group(1)
    var = re.fullmatch(r"var\((--brand-[\w-]+)\)", value)
    if not var:
        return value
    pair = colours.get(var.group(1))
    if not pair:
        raise SystemExit("gen_glyph_data: no stylesheet value for %s" % var.group(1))
    return {"light": pair.get("light", "#000000"), "dark": pair.get("dark", pair.get("light", "#ffffff"))}


def inner(svg: str) -> str:
    """Everything inside the <svg>, kept as markup.

    Carried as a STRING rather than parsed into a tree, because these are
    somebody else's drawings: gradients, clip paths and nested groups, and a
    parser that understood only what today's fifty-five happen to use would
    drop part of the fifty-sixth without a word. The phone turns this into
    react-native-svg elements at load time, and anything it cannot turn is
    reported rather than skipped.
    """
    body = re.sub(r"^<svg[^>]*>", "", svg.strip(), count=1)
    return re.sub(r"</svg>$", "", body).strip()


HEADER = """// The drawings, as data.
//
// GENERATED by scripts/gen_glyph_data.py from the two generated component
// files. Do not hand-edit: regenerate, or the next run discards the change.
//
// It exists so the phone and the browser draw ONE icon set. The components in
// `components/glyphs.tsx` return `<svg>`, which Metro cannot parse and React
// Native has no element for; the drawings themselves are only path data, so
// they travel and the elements do not.

export interface GlyphPart {
  /** SVG path data. */
  d?: string
  /** A rounded rectangle, as [x, y, width, height, rx]. */
  rect?: number[]
  /** `none` where the shape is stroked rather than filled. */
  fill?: string
  /** Stroke width, for the one mark drawn as a line. */
  stroke?: number
}

export interface GlyphGroup {
  transform?: string
  parts: GlyphPart[]
}

/** One of the app's own marks: one grid, one convention, no colour of its own. */
export interface GlyphData {
  box: string
  groups: GlyphGroup[]
}

/** A brand mark: somebody else's drawing, kept whole, with the colour it is
 *  drawn in - one value, or one per theme where it cannot be read on both. */
export interface BrandData {
  box: string
  fill: string | { light: string; dark: string } | null
  /** The markup inside the `<svg>`, verbatim. */
  svg: string
}

"""


def main() -> int:
    glyphs = app_glyphs()
    if len(glyphs) < 30:
        raise SystemExit("gen_glyph_data: only %d app glyphs parsed, expected the whole set" % len(glyphs))
    brands = brand_glyphs(brand_colours())
    if len(brands) < 40:
        raise SystemExit("gen_glyph_data: only %d brand marks parsed" % len(brands))

    body = [
        HEADER,
        "export const GLYPHS: Record<string, GlyphData> = ",
        json.dumps(glyphs, indent=2, ensure_ascii=False),
        "\n\nexport const BRANDS: Record<string, BrandData> = ",
        json.dumps(brands, indent=2, ensure_ascii=False),
        "\n",
    ]
    io.open(OUT, "w", encoding="utf-8", newline="\n").write("".join(body))
    print("wrote %s: %d glyphs, %d brand marks" % (OUT, len(glyphs), len(brands)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
