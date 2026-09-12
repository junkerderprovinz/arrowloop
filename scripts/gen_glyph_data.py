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
DONATE_TSX = ROOT / "web" / "src" / "components" / "donateMarks.tsx"
DONATE_CSS = ROOT / "web" / "src" / "donateMarks.css"
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
    # The coin discs live in their own stylesheet and follow the same
    # dark-first shape, so they are read as one table rather than two: the
    # marks that need them sit in the same generated file.
    text += "\n" + io.open(DONATE_CSS, encoding="utf-8").read()

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
            for name, value in re.findall(r"(--(?:brand|coin)-[\w-]+):\s*([^;]+);", body):
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
        for name, value in re.findall(r"(--(?:brand|coin)-[\w-]+):\s*([^;]+);", body):
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

    Lifted for exactly the reason the brand marks were: they are JSX returning
    `<svg>` children, Metro has no element for that, and the phone's About card
    offers the same three ways to give as the desktop's. A second hand-kept set
    of coin discs would be a Bitcoin logo that agreed with the container until
    the day one of them was touched.

    Their shape is the brand marks' shape - a box and some markup - so they
    travel in the same structure and are drawn by the same renderer. Two of them
    carry a theme colour INSIDE the drawing (XRP and Solana wear the inverted
    lockup their brands publish for a dark ground), which is precisely what the
    placeholder machinery below already exists for.
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
            # Every coin disc is drawn on this grid; the file says so once, at
            # the top of the map, rather than per entry.
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

    They sit in the same file as the coins and are a different kind of thing.
    Each is one path on a 24 grid filling with `currentColor`, which is the
    APP GLYPH shape rather than the brand shape: they ride on a filled button
    beside their own label and take the label's ink, exactly like every other
    button mark in the product.

    The crypto button's mark is not here because it is not a third drawing: it
    is the Bitcoin disc, which already travels with the coins.

    They are lifted separately from the app's own set, and stay out of the rule
    table, because they are BRANDS. A rule keyed on "coffee" would put a
    company's cup on anything mentioning coffee and one on "crypto" would put
    the Bitcoin symbol on settings that have nothing to do with it, so each is
    passed explicitly at the one call site that means it - on both surfaces.
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
        # `box={B24}` names a constant rather than spelling the numbers, so the
        # constant is read rather than assumed: a second grid arriving here
        # would otherwise be drawn on the first one's box and land off-centre.
        value = re.search(r'const %s = "([^"]+)";' % re.escape(box), text)
        if not value:
            raise SystemExit("gen_glyph_data: no box constant %s for %s" % (box, name))
        out[name] = {"box": value.group(1), "groups": [{"parts": [{"d": d}]}]}
    if len(out) < 2:
        raise SystemExit("gen_glyph_data: only %d link marks parsed" % len(out))
    return out


def resolve(match, colours) -> dict[str, str] | str | None:
    """A colour, as the phone needs it: a literal, or one per theme."""
    if not match:
        return None
    value = match.group(1)
    var = re.fullmatch(r"var\((--(?:brand|coin)-[\w-]+)\)", value)
    if not var:
        return value
    pair = colours.get(var.group(1))
    if not pair:
        raise SystemExit("gen_glyph_data: no stylesheet value for %s" % var.group(1))
    return {"light": pair.get("light", "#000000"), "dark": pair.get("dark", pair.get("light", "#ffffff"))}


# JSX camelCase to the SVG attribute names a parser knows. Only the ones the
# fifty-five actually use; anything else raises rather than being dropped.
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

# `style={{ fill: "#0066da", fillRule: "evenodd" }}` - React's own way of
# writing what SVG spells as attributes.
STYLE = re.compile(r'style=\{\{(.*?)\}\}', re.S)
PAIR = re.compile(r'(\w+):\s*"([^"]*)"')

# `{/* why this disc is black */}` - a JSX comment, which is an expression and
# not markup at all. The coin marks are hand-written rather than generated and
# several of them say why they differ from the icon set they came from, so the
# note has to be dropped here rather than reaching an XML parser.
JSX_COMMENT = re.compile(r"\{/\*.*?\*/\}\s*", re.S)


def unjsx(markup: str) -> str:
    """React inline styles, rewritten as plain SVG attributes.

    Three marks came out blank on the phone and nothing said why: they are the
    ones whose source carried `style={{ fill: ... }}`, which a browser's JSX
    compiler understands and an SVG parser does not. It is not a rendering
    difference to work around - it is markup that was never SVG - so it is
    translated once here rather than guessed at by each surface.
    """

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
    """Theme colours used INSIDE a drawing, pulled out as named slots.

    Three marks stayed blank on the phone after the JSX fix, and for a second
    reason: their per-path fills are `var(--brand-putio-1)`, which a browser
    resolves from the stylesheet and an SVG parser leaves as an unknown colour.
    The root fill was already being resolved; these are the ones that carry
    theme colours further in.

    Two answers per slot, because a mark carrying a theme colour is exactly the
    mark that needs a different one on a dark page. The renderer substitutes at
    draw time, which is the only moment the theme is known.
    """
    used: dict[str, dict[str, str]] = {}

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

    # Anything still spelled `var(...)` is a colour this does not know how to
    # look up, and it would reach the phone as a fill nothing can resolve: no
    # error, no log line, a blank square where a logo belongs. That is exactly
    # how OpenDrive, put.io and Quatrix came out empty, so it stops here now.
    left = re.search(r"var\([^)]*\)", body)
    if left:
        raise SystemExit("gen_glyph_data: a colour no stylesheet answers for: %s" % left.group(0))
    return body, used


# Marks whose gradients the phone cannot draw, and what to do about it.
#
# OneDrive is the case this exists for. Its source is a Cairo export: NINE
# stacked gradients for one cloud, several of them full-canvas overlays at low
# opacity whose whole job is to tint what is underneath. A browser composites
# that correctly; react-native-svg draws the cloud BLACK, which is what reached
# the phone and what was reported.
#
# The first answer was to paint every gradient in the mark ONE brand colour.
# That stopped the black and produced a blue blob: the cloud is three tones and
# came out as one, next to a container that renders the real thing. jdp: "Das
# logo von onedrive ist in der app falsch, im container richtig."
#
# So each gradient is now judged on its own stops:
#
#   - every stop fully opaque  ->  it is PAINT. Replaced by the colour of the
#     stop nearest the middle, which is the tone the shape mostly reads as.
#   - any stop transparent     ->  it is a SHADE, drawn over the paint to
#     lighten or darken it. The element goes, because a shade reduced to a
#     solid is a slab of colour across the drawing rather than a hint of one.
#
# What is left is the brand's own drawing, path for path, in its own tones,
# minus the shading nobody can see at forty pixels. The BROWSER keeps the
# gradients, because it renders them correctly - this only changes what
# `glyphs.data.ts` carries.
SOLIDIFY = {"IconOnedrive"}


STOP = re.compile(r"<stop\b[^>]*?/?>", re.S)
STOP_OFFSET = re.compile(r'offset="([^"]+)"')
STOP_COLOUR = re.compile(r'stop-color="([^"]+)"')
STOP_OPACITY = re.compile(r'stop-opacity="([^"]+)"')


def _stops(inner: str):
    """Every stop as (offset, colour, opacity), read from ATTRIBUTES.

    Attributes rather than a style object, because unjsx has already made that
    translation one step earlier - that is the whole reason it exists. Reading
    the JSX form here matched nothing at all.

    A missing stop-opacity is 1: SVG's own default, and leaving it out is the
    ordinary way to write a fully opaque stop.
    """
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
            "gen_glyph_data: %s is on the solidify list and has no gradient fills - "
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
        # The stop nearest the middle, which is the tone the shape reads as.
        middle = min(stops, key=lambda s: abs(float(s[0]) - 0.5))
        paint[gid] = _rgb(middle[1])

    # A shade's element goes entirely. Matched on the whole element so nothing
    # is left behind with a fill nothing answers for.
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
            "gen_glyph_data: %s came out with no paint at all - every gradient read as a "
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

    SVG lets one gradient take another's stops with `xlink:href`, and it is how
    every icon set with a two-tone drawing avoids writing the same four stops
    three times. react-native-svg's XML parser does not implement it AT ALL -
    the attribute is not in its table - so an inheriting gradient arrives with
    no stops, a fill referencing it resolves to nothing, and the shape is
    painted BLACK.

    That is not a theory. pCloud reached the phone as a black cloud with a
    turquoise P and OneDrive as a plain black cloud, on a screen of fifty-five
    logos that were otherwise right, and nothing anywhere said why - the same
    silent-and-total failure the `style={{...}}` and `var(--brand-*)` fixes
    above were written for, one layer further in.

    So the stops are copied at generation time, which is the only moment both
    gradients are in one string. The phone then sees two ordinary gradients.

    The ATTRIBUTES are not copied, only the stops: an inheriting gradient
    usually overrides the coordinates, which is the whole reason it inherits
    rather than being reused, and copying them over would move the second
    gradient onto the first one's axis.
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

    # A gradient with no stops at all paints black wherever it is referenced,
    # and black on a logo is indistinguishable from "this brand's mark is
    # black". The generator refuses rather than shipping it.
    for match in GRADIENT.finditer(body):
        if "<stop" not in (match.group(4) or ""):
            got = HAS_ID.search(match.group(2))
            raise SystemExit(
                "gen_glyph_data: %s has a gradient with no stops (%s) - anything filled with it draws black"
                % (name, got.group(1) if got else "unnamed")
            )
    return body


def inner(svg: str, name: str) -> str:
    """Everything inside the <svg>, kept as markup.

    Carried as a STRING rather than parsed into a tree, because these are
    somebody else's drawings: gradients, clip paths and nested groups, and a
    parser that understood only what today's fifty-five happen to use would
    drop part of the fifty-sixth without a word. The phone turns this into
    react-native-svg elements at load time, and anything it cannot turn is
    reported rather than skipped.
    """
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
// It exists so the phone and the browser draw ONE icon set. The components in
// `components/glyphs.tsx` return `<svg>`, which Metro cannot parse and React
// Native has no element for; the drawings themselves are only path data, so
// they travel and the elements do not.
//
// Three sets, one shape: the app's own glyphs, the storage providers' brand
// marks, and the coin marks the donation window wears. The coins are here for
// the same reason the brands are, not because they are icons - they are
// somebody else's logo living in a React file that only the browser can read.

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
  /**
   * The markup inside the `<svg>`, with any theme colour left as `{{name}}`.
   *
   * A placeholder rather than a resolved colour because the theme is not known
   * until the mark is drawn, and a mark whose own paths carry a theme colour is
   * precisely the one that needs a different colour on a dark page.
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
