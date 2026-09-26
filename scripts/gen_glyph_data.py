"""Turn the generated glyph components into data both bundlers can read.

`web/src/components/glyphs.tsx` and `brandGlyphs.tsx` return `<svg>`, which
React Native has no element for. The drawings are only path data, so this lifts
them into `web/src/lib/glyphs.data.ts` and the phone renders the same paths
through react-native-svg, keeping one icon set for both.

It reads the generated files, so neither source set has to be installed. Run it
after gen_glyphs.py or gen_brand_glyphs.py; `glyphs.parity.test.ts` fails if
you forget.
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
DONATE_TSX = ROOT / "web" / "src" / "components" / "donateMarks.tsx"
DONATE_CSS = ROOT / "web" / "src" / "donateMarks.css"
OUT = ROOT / "web" / "src" / "lib" / "glyphs.data.ts"

# `paths={['a', 'b']}`: single-quoted strings with backslash escapes.
STRINGS = re.compile(r"'((?:[^'\\]|\\.)*)'")


def unquote(raw: str) -> str:
    return raw.replace("\\'", "'").replace("\\\\", "\\")


def app_glyphs() -> dict[str, dict]:
    """The app's own set: one grid, one convention, no gradients."""
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
    stroked polyline. Anything else raises rather than leaving a button with no
    mark."""
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


def brand_colours() -> dict[str, dict[str, str]]:
    """`--brand-x-0` per theme, from the stylesheet the web reads them through.

    Two answers per name, because several marks carry a colour that cannot be
    read on one of the two grounds, such as a black wordmark on a dark page.
    """
    text = io.open(BRANDS_CSS, encoding="utf-8").read()
    # The coin discs' stylesheet has the same dark-first shape.
    text += "\n" + io.open(DONATE_CSS, encoding="utf-8").read()

    # A block inside `@media (prefers-color-scheme: light)` is the light answer
    # whatever its own selector says, and the innermost-block regex below never
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
            for name, value in re.findall(r"(--(?:brand|coin)-[\w-]+):\s*([^;]+);", body):
                out.setdefault(name, {})["light"] = value.strip()
            continue
        if ":hover" in selector:
            continue
        # `:not([data-theme="dark"])` names dark to exclude it, which a plain
        # substring test would read as the dark block.
        naked = re.sub(r":not\([^)]*\)", "", selector)
        if 'data-theme="light"' in naked:
            theme = "light"
        elif 'data-theme="dark"' in naked or ":root" in naked:
            # The stylesheet is dark-first: the bare `:root` block is grouped
            # with `[data-theme="dark"]` and carries the dark values.
            theme = "dark"
        else:
            continue
        for name, value in re.findall(r"(--(?:brand|coin)-[\w-]+):\s*([^;]+);", body):
            out.setdefault(name, {})[theme] = value.strip()

    # No mark differing between the themes means the stylesheet was misread.
    swapped = sum(1 for pair in out.values() if pair.get("light") != pair.get("dark"))
    if swapped == 0:
        raise SystemExit("gen_glyph_data: no mark differs between the themes; the stylesheet was misread")
    return out


def brand_glyphs(colours: dict[str, dict[str, str]]) -> dict[str, dict]:
    """The brand marks: somebody else's drawings, with gradients and theme
    colours."""
    text = io.open(BRANDS_TSX, encoding="utf-8").read()
    out: dict[str, dict] = {}
    for match in re.finditer(
        r"export function (Icon\w+)\(props[^)]*\) \{\s*return \(\s*(?:<>\s*)?(<svg .*?</svg>)\s*(?:<svg .*?</svg>\s*</>\s*)?\)\s*\}",
        text,
        re.S,
    ):
        # A mark with a second drawing for the lit tile comes as a pair, the
        # resting one first. The phone has no lit tiles and takes that one.
        name, svg = match.groups()
        box = re.search(r'viewBox="([^"]+)"', svg)
        if not box:
            raise SystemExit("gen_glyph_data: %s has no viewBox" % name)
        body, used = detokenise(inner(svg, name), colours)
        out[name] = {
            "box": box.group(1),
            "fill": resolve(re.search(r'<svg[^>]*\bfill="([^"]+)"', svg), colours),
            "svg": body,
            "vars": used,
        }
    return out


def coin_marks(colours: dict[str, dict[str, str]]) -> dict[str, dict]:
    """The donation window's coin logos, out of the COINS map.

    They travel in the brand marks' structure, a box and some markup. XRP and
    Solana carry a theme colour inside the drawing, the inverted lockup their
    brands publish for a dark ground.
    """
    text = io.open(DONATE_TSX, encoding="utf-8").read()
    start = text.index("const COINS: Record<string, ReactNode> = {")
    body = text[start:text.index("\n};", start)]

    out: dict[str, dict] = {}
    for match in re.finditer(r"\n  (\w+): \(\s*<>(.*?)</>\s*\),", body, re.S):
        coin, markup = match.groups()
        drawing, used = detokenise(unjsx(markup).strip(), colours)
        left = re.search(r"\w+=\{", drawing)
        if left:
            raise SystemExit("gen_glyph_data: JSX left in coin %s: %r" % (coin, drawing[:80]))
        out[coin] = {
            # Every coin disc is drawn on this grid.
            "box": "0 0 32 32",
            "fill": None,
            "svg": drawing,
            "vars": used,
        }
    if len(out) < 5:
        raise SystemExit("gen_glyph_data: only %d coin marks parsed" % len(out))
    return out


def link_marks() -> dict[str, dict]:
    """The two marks that are not coins: Buy Me a Coffee and PayPal.

    Each is one path on a 24 grid filled with `currentColor`, the app glyph
    shape, since they take the ink of the button label beside them. The crypto
    button wears the Bitcoin disc from the coins.

    They stay out of the app's own set and its rule table because they are
    brands: a rule keyed on "coffee" would put a company's cup on anything
    mentioning coffee. Each is passed explicitly where it is meant.
    """
    text = io.open(DONATE_TSX, encoding="utf-8").read()
    out: dict[str, dict] = {}
    for match in re.finditer(
        r"export function (Icon\w+)\([^)]*\)[^{]*\{\s*return \(\s*<Mark\s+box=\{(\w+)\}"
        r"\s+size=\{size\}\s+d=\"([^\"]+)\"\s*/>\s*\);?\s*\}",
        text,
        re.S,
    ):
        name, box, d = match.groups()
        # `box={B24}` names a constant, which is read rather than assumed in
        # case a second grid arrives.
        value = re.search(r'const %s = "([^"]+)";' % re.escape(box), text)
        if not value:
            raise SystemExit("gen_glyph_data: no box constant %s for %s" % (box, name))
        out[name] = {"box": value.group(1), "groups": [{"parts": [{"d": d}]}]}
    if len(out) < 2:
        raise SystemExit("gen_glyph_data: only %d link marks parsed" % len(out))
    return out


# A lit tile in the browser repaints a mark through --mark-ink and --mark-cut.
# The phone has no lit tiles, so each part keeps its own colour.
LIT = re.compile(r"var\(--mark-(?:ink|cut),\s*((?:[^()]|\([^()]*\))*)\)")


def resolve(match, colours) -> dict[str, str] | str | None:
    """A colour, as the phone needs it: a literal, or one per theme."""
    if not match:
        return None
    value = LIT.sub(r"\1", match.group(1))
    var = re.fullmatch(r"var\((--(?:brand|coin)-[\w-]+)\)", value)
    if not var:
        return value
    pair = colours.get(var.group(1))
    if not pair:
        raise SystemExit("gen_glyph_data: no stylesheet value for %s" % var.group(1))
    return {"light": pair.get("light", "#000000"), "dark": pair.get("dark", pair.get("light", "#ffffff"))}


# JSX camelCase to the SVG attribute names a parser knows, only the ones the
# marks use; anything else raises rather than being dropped.
STYLE_ATTR = {
    "clipPath": "clip-path",
    "clipRule": "clip-rule",
    "fill": "fill",
    "fillOpacity": "fill-opacity",
    "fillRule": "fill-rule",
    "isolation": "isolation",
    "mask": "mask",
    "opacity": "opacity",
    "stopColor": "stop-color",
    "stopOpacity": "stop-opacity",
    "stroke": "stroke",
    "strokeDasharray": "stroke-dasharray",
    "strokeLinecap": "stroke-linecap",
    "strokeLinejoin": "stroke-linejoin",
    "strokeMiterlimit": "stroke-miterlimit",
    "strokeOpacity": "stroke-opacity",
    "strokeWidth": "stroke-width",
}

# `style={{ fill: "#0066da", fillRule: "evenodd" }}`, React's way of writing
# what SVG spells as attributes.
STYLE = re.compile(r'style=\{\{(.*?)\}\}', re.S)
PAIR = re.compile(r'(\w+):\s*"([^"]*)"')

# `{/* why this disc is black */}`: a JSX comment in the hand-written coin marks,
# which is an expression rather than markup and must not reach an XML parser.
JSX_COMMENT = re.compile(r"\{/\*.*?\*/\}\s*", re.S)


def unjsx(markup: str) -> str:
    """React inline styles, rewritten as plain SVG attributes, since an SVG
    parser draws a mark carrying `style={{ fill: ... }}` blank."""

    def one(match: re.Match) -> str:
        out = []
        for name, value in PAIR.findall(match.group(1)):
            attr = STYLE_ATTR.get(name)
            if attr is None:
                raise SystemExit("gen_glyph_data: unknown style property %r in a brand mark" % name)
            out.append('%s="%s"' % (attr, value))
        return " ".join(out)

    return STYLE.sub(one, JSX_COMMENT.sub("", markup))


def detokenise(body: str, colours) -> tuple[str, dict]:
    """Theme colours used inside a drawing, pulled out as named slots.

    An SVG parser cannot resolve a per-path fill such as `var(--brand-putio-1)`.
    Each slot gets a light and a dark answer, and the renderer substitutes them
    at draw time, when the theme is known.
    """
    used: dict[str, dict[str, str]] = {}

    body = LIT.sub(r"\1", body)

    def one(match: re.Match) -> str:
        name = match.group(1)
        pair = colours.get(name)
        if not pair:
            raise SystemExit("gen_glyph_data: no stylesheet value for %s" % name)
        used[name] = {
            "light": pair.get("light", "#000000"),
            "dark": pair.get("dark", pair.get("light", "#ffffff")),
        }
        return "{{%s}}" % name

    body = re.sub(r"var\((--(?:brand|coin)-[\w-]+)\)", one, body)

    # Any other `var(...)` would reach the phone as a fill nothing resolves, a
    # blank square where a logo belongs.
    left = re.search(r"var\([^)]*\)", body)
    if left:
        raise SystemExit("gen_glyph_data: a colour no stylesheet answers for: %s" % left.group(0))
    return body, used


# Marks whose gradients react-native-svg draws black. OneDrive's source is a
# Cairo export with nine stacked gradients for one cloud, several of them
# full-canvas tints at low opacity. Each gradient is judged on its own stops:
#
#   every stop fully opaque:  paint, replaced by the colour of the stop nearest
#                             the middle, the tone the shape mostly reads as.
#   any stop transparent:     a shade over the paint. The element goes, since
#                             a shade reduced to a solid is a slab of colour.
#
# The browser keeps the gradients; this only changes what `glyphs.data.ts`
# carries.
SOLIDIFY = {"IconOnedrive"}


STOP = re.compile(r"<stop\b[^>]*?/?>", re.S)
STOP_OFFSET = re.compile(r'offset="([^"]+)"')
STOP_COLOUR = re.compile(r'stop-color="([^"]+)"')
STOP_OPACITY = re.compile(r'stop-opacity="([^"]+)"')


def _stops(inner: str):
    """Every stop as (offset, colour, opacity), read from the attributes unjsx
    has already written. A missing stop-opacity is SVG's default of 1."""
    out = []
    for tag in STOP.findall(inner):
        offset = STOP_OFFSET.search(tag)
        colour = STOP_COLOUR.search(tag)
        if not colour:
            continue
        opacity = STOP_OPACITY.search(tag)
        out.append((
            offset.group(1) if offset else "0",
            colour.group(1),
            opacity.group(1) if opacity else "1",
        ))
    return out
GRADIENT_BLOCK = re.compile(
    r'<(linearGradient|radialGradient)\b[^>]*?id="([^"]+)"[^>]*?>(.*?)</\1>', re.S
)


def _rgb(value: str) -> str:
    """Cairo writes rgb(28.235294%,58.039216%,99.607843%). Hex is what a phone
    parses fastest and what every other colour in this file already is."""
    inside = value.strip()
    if inside.startswith("#"):
        return inside
    parts = re.findall(r"([\d.]+)%", inside)
    if len(parts) != 3:
        raise SystemExit("gen_glyph_data: a stop colour this cannot read: %s" % value)
    return "#" + "".join("%02X" % round(float(p) * 255 / 100) for p in parts)


def solidify(body: str, name: str) -> str:
    """Turn each gradient into paint or into nothing, per the rule above."""
    if name not in SOLIDIFY:
        return body
    if "url(#" not in body:
        raise SystemExit(
            "gen_glyph_data: %s is on the solidify list and has no gradient fills; "
            "either it was fixed upstream and the entry should go, or the name is wrong" % name
        )

    paint, shade = {}, set()
    for block in GRADIENT_BLOCK.finditer(body):
        gid, inner = block.group(2), block.group(3)
        stops = _stops(inner)
        if not stops:
            raise SystemExit("gen_glyph_data: %s has a gradient with no stops: %s" % (name, gid))
        if any(float(op) < 1 for _, _, op in stops):
            shade.add(gid)
            continue
        middle = min(stops, key=lambda s: abs(float(s[0]) - 0.5))
        paint[gid] = _rgb(middle[1])

    # Matched on the whole element, so nothing is left with a fill nothing
    # answers for.
    for gid in shade:
        pattern = re.compile(
            r'<(path|circle|ellipse|rect|polygon)\b[^>]*?url\(#%s\)[^>]*?/>\s*' % re.escape(gid),
            re.S,
        )
        body, gone = pattern.subn("", body)
        if not gone:
            raise SystemExit(
                "gen_glyph_data: %s has a shade gradient %s nothing uses, or used by an "
                "element shape this does not know" % (name, gid)
            )

    for gid, colour in paint.items():
        body = body.replace('url(#%s)' % gid, colour)

    body = re.sub(r"<defs>.*?</defs>\s*", "", body, flags=re.S)
    left = body.count("url(#")
    if left:
        raise SystemExit(
            "gen_glyph_data: %s still references %d gradients after solidifying" % (name, left)
        )
    if not paint:
        raise SystemExit(
            "gen_glyph_data: %s came out with no paint at all; every gradient read as a "
            "shade, which would leave an empty mark" % name
        )
    return body


# A gradient that inherits its stops from another one, spelled out.
GRADIENT = re.compile(
    r"<(linearGradient|radialGradient)\b([^>]*?)(/>|>(.*?)</\1>)", re.S
)
INHERITS = re.compile(r'\sxlink[Hh]ref="#([^"]+)"')
HAS_ID = re.compile(r'\sid="([^"]+)"')


def unlink(body: str, name: str) -> str:
    """Copy inherited gradient stops in, because the phone cannot follow a link.

    react-native-svg does not implement `xlink:href` on a gradient, so an
    inheriting gradient arrives with no stops and paints its shape black. Only
    the stops are copied: an inheriting gradient usually overrides the
    coordinates, and copying those would move it onto the source's axis.
    """
    stops: dict[str, str] = {}
    for match in GRADIENT.finditer(body):
        got = HAS_ID.search(match.group(2))
        if got and match.group(4):
            stops[got.group(1)] = match.group(4)

    def one(match: re.Match) -> str:
        attrs, inner_body = match.group(2), match.group(4) or ""
        link = INHERITS.search(attrs)
        if not link:
            return match.group(0)
        source = stops.get(link.group(1))
        if source is None:
            raise SystemExit(
                "gen_glyph_data: %s inherits gradient stops from #%s, which is not in the same drawing"
                % (name, link.group(1))
            )
        attrs = INHERITS.sub("", attrs)
        return "<%s%s>%s%s</%s>" % (match.group(1), attrs, inner_body, source, match.group(1))

    body = GRADIENT.sub(one, body)

    # A gradient with no stops paints black, which on a logo passes for the
    # brand's own colour.
    for match in GRADIENT.finditer(body):
        if "<stop" not in (match.group(4) or ""):
            got = HAS_ID.search(match.group(2))
            raise SystemExit(
                "gen_glyph_data: %s has a gradient with no stops (%s); anything filled with it draws black"
                % (name, got.group(1) if got else "unnamed")
            )
    return body


def inner(svg: str, name: str) -> str:
    """Everything inside the <svg>, kept as markup rather than parsed, since a
    parser covering only today's marks would silently drop part of the next
    one. The phone reports anything it cannot turn into an element."""
    body = re.sub(r"^<svg[^>]*>", "", svg.strip(), count=1)
    body = re.sub(r"</svg>$", "", body).strip()
    body = unjsx(body)
    body = unlink(body, name)
    body = solidify(body, name)
    left = re.search(r"\w+=\{", body)
    if left:
        raise SystemExit("gen_glyph_data: JSX left in a brand mark: %r" % body[left.start() - 20 : left.start() + 60])
    return body


HEADER = """// The drawings, as data.
//
// GENERATED by scripts/gen_glyph_data.py from the two generated component
// files. Do not hand-edit: regenerate, or the next run discards the change.
//
// The phone and the browser draw one icon set. The components return `<svg>`,
// which React Native has no element for, so only the path data travels: the
// app's own glyphs, the storage providers' brand marks and the donation coins.

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
 *  drawn in, one value or one per theme where it cannot be read on both. */
export interface BrandData {
  box: string
  fill: string | { light: string; dark: string } | null
  /**
   * The markup inside the `<svg>`, with any theme colour left as `{{name}}`
   * until the mark is drawn and the theme is known.
   */
  svg: string
  /** What each `{{name}}` in `svg` resolves to, per theme. */
  vars: Record<string, { light: string; dark: string }>
}

"""


def main() -> int:
    glyphs = app_glyphs()
    if len(glyphs) < 30:
        raise SystemExit("gen_glyph_data: only %d app glyphs parsed, expected the whole set" % len(glyphs))
    colours = brand_colours()
    brands = brand_glyphs(colours)
    if len(brands) < 40:
        raise SystemExit("gen_glyph_data: only %d brand marks parsed" % len(brands))
    coins = coin_marks(colours)
    links = link_marks()

    body = [
        HEADER,
        "export const GLYPHS: Record<string, GlyphData> = ",
        json.dumps(glyphs, indent=2, ensure_ascii=False),
        "\n\nexport const BRANDS: Record<string, BrandData> = ",
        json.dumps(brands, indent=2, ensure_ascii=False),
        "\n\nexport const COINS: Record<string, BrandData> = ",
        json.dumps(coins, indent=2, ensure_ascii=False),
        "\n\nexport const DONATE_GLYPHS: Record<string, GlyphData> = ",
        json.dumps(links, indent=2, ensure_ascii=False),
        "\n",
    ]
    io.open(OUT, "w", encoding="utf-8", newline="\n").write("".join(body))
    print(
        "wrote %s: %d glyphs, %d brand marks, %d coin marks, %d link marks"
        % (OUT, len(glyphs), len(brands), len(coins), len(links))
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
