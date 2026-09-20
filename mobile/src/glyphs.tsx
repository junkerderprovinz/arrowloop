import Svg, { G, Path, Rect, SvgXml } from "react-native-svg";
import {
  BRANDS,
  COINS,
  DONATE_GLYPHS,
  GLYPHS,
  type BrandData,
  type GlyphData,
} from "../../web/src/lib/glyphs.data";
import { glyphNameFor } from "../../web/src/lib/glyphName";
import { BRAND } from "./theme";

// The web app's icon set and brand marks, drawn from the generated
// web/src/lib/glyphs.data.ts so both apps share one set. Text symbols such as
// "✓" would take whatever the handset's font draws.

/** The default size of every mark. */
export const GLYPH = 16;

/** One of the app's own marks, drawn in the given ink. */
export function Glyph({
  name,
  color,
  size = GLYPH,
  width,
  height,
}: {
  name: string;
  color: string;
  size?: number;
  /** A non-square box; both default to `size`. */
  width?: number;
  height?: number;
}) {
  const glyph = GLYPHS[name];
  if (!glyph) return null;
  return <Drawn glyph={glyph} color={color} width={width ?? size} height={height ?? size} />;
}

/**
 * Draws a mark on the app's grid in one ink. Separate from Glyph so the two
 * donation marks, which are not in the app's set, draw the same way.
 */
function Drawn({
  glyph,
  color,
  width,
  height,
}: {
  glyph: GlyphData;
  color: string;
  width: number;
  height: number;
}) {
  return (
    <Svg width={width} height={height} viewBox={glyph.box}>
      {glyph.groups.map((group, gi) => (
        <G key={gi} transform={group.transform}>
          {group.parts.map((part, pi) =>
            part.rect ? (
              <Rect
                key={pi}
                x={part.rect[0]}
                y={part.rect[1]}
                width={part.rect[2]}
                height={part.rect[3]}
                rx={part.rect[4]}
                fill={color}
              />
            ) : (
              <Path
                key={pi}
                d={part.d}
                // The one stroked mark takes no fill; the rest are even-odd
                // filled shapes, as the source set was drawn.
                fill={part.fill === "none" ? "none" : color}
                fillRule="evenodd"
                stroke={part.stroke ? color : undefined}
                strokeWidth={part.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}
        </G>
      ))}
    </Svg>
  );
}

/** The mark a button wears for its label key, through the shared rule table. */
export function glyphNameForKey(key: string): string | undefined {
  return glyphNameFor(key);
}

/**
 * A brand mark, rendered whole through SvgXml since the marks use gradients,
 * clip paths and nested groups. `scheme` picks the second colour some marks
 * carry for the theme they would vanish on.
 */
export function BrandMark({
  name,
  size = 20,
  width,
  height,
  scheme,
  mono,
}: {
  name: string;
  size?: number;
  /** A wide box for wordmarks, which letterbox inside a square. */
  width?: number;
  height?: number;
  scheme: "dark" | "light";
  /** An ink to draw the mark in, where it stands in for a glyph. */
  mono?: string;
}) {
  const brand = BRANDS[name];
  if (!brand) return null;
  return (
    <SvgXml
      xml={mono ? oneInk(whole(brand, scheme), mono) : whole(brand, scheme)}
      width={width ?? size}
      height={height ?? size}
    />
  );
}

/**
 * Repaints every fill and stroke in one ink. `none` is left alone, since it
 * cuts the holes that keep an outline from becoming a blob.
 */
function oneInk(svg: string, ink: string): string {
  return svg
    .replace(/fill="(?!none")[^"]*"/g, `fill="${ink}"`)
    .replace(/stroke="(?!none")[^"]*"/g, `stroke="${ink}"`);
}

/**
 * Wraps a mark's markup in an svg element and fills in its themed colour
 * slots, which an SVG parser cannot resolve the way a browser resolves CSS
 * variables.
 */
function whole(mark: BrandData, scheme: "dark" | "light"): string {
  const fill =
    mark.fill === null ? undefined : typeof mark.fill === "string" ? mark.fill : mark.fill[scheme];
  let body = mark.svg;
  for (const [slot, pair] of Object.entries(mark.vars)) {
    body = body.split(`{{${slot}}}`).join(pair[scheme]);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.box}"${
    fill ? ` fill="${fill}"` : ""
  }>${body}</svg>`;
}

/**
 * A coin's logo for the crypto dialog, passed explicitly rather than through
 * the glyph rule table. An unknown id draws nothing; the tile still shows its
 * ticker.
 */
export function CoinMark({
  coin,
  size = 22,
  scheme,
}: {
  coin: string;
  size?: number;
  scheme: "dark" | "light";
}) {
  const mark = COINS[coin];
  if (!mark) return null;
  return <SvgXml xml={whole(mark, scheme)} width={size} height={size} />;
}

/**
 * A mark for the About card's donation and repository buttons, always passed
 * explicitly. The colours come from BRAND in theme.ts rather than the button's
 * ink; the Bitcoin disc keeps its own colours.
 */
export function DonateMark({
  name,
  size = GLYPH,
  scheme,
}: {
  name: "coffee" | "paypal" | "bitcoin" | "github";
  size?: number;
  scheme: "dark" | "light";
}) {
  if (name === "bitcoin") return <CoinMark coin="btc" size={size} scheme={scheme} />;
  const colour = BRAND[scheme][name];
  if (name === "github") {
    const mark = BRANDS.IconGithub;
    if (!mark) return null;
    // The fill is forced, since the stylesheet's published near-black is
    // unreadable on the dark theme.
    return (
      <SvgXml
        xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.box}" fill="${colour}">${mark.svg}</svg>`}
        width={size}
        height={size}
      />
    );
  }
  const glyph = DONATE_GLYPHS[name === "coffee" ? "IconBuyMeACoffee" : "IconPayPal"];
  if (!glyph) return null;
  return <Drawn glyph={glyph} color={colour} width={size} height={size} />;
}

export function hasBrandMark(name: string | undefined): boolean {
  return !!name && name in BRANDS;
}

/**
 * A storage provider's mark, which names either a brand logo (drawn in its
 * own colours) or an app glyph (drawn in the surrounding ink). Several
 * providers have no mark, since a wrong logo is worse than none.
 */
export function ProviderMark({
  name,
  size = 20,
  width,
  height,
  color,
  scheme,
  mono,
}: {
  name: string | undefined;
  size?: number;
  /** A non-square box, for a tile that gives a wordmark its width. */
  width?: number;
  height?: number;
  /** The ink for an app glyph, and for a brand too when `mono` is set. */
  color: string;
  scheme: "dark" | "light";
  /** Draws a brand in `color` rather than its own colours. */
  mono?: boolean;
}) {
  if (!name) return null;
  if (name in BRANDS)
    return (
      <BrandMark
        name={name}
        size={size}
        width={width}
        height={height}
        scheme={scheme}
        mono={mono ? color : undefined}
      />
    );
  if (name in GLYPHS)
    return <Glyph name={name} color={color} size={size} width={width} height={height} />;
  return null;
}

export function hasMark(name: string | undefined): boolean {
  return !!name && (name in BRANDS || name in GLYPHS);
}
