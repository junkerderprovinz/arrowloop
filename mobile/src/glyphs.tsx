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

/**
 * The same marks the browser draws, drawn here.
 *
 * The app's set and the brand marks both come out of `glyphs.data.ts`, which is
 * generated from the two generated component files - so there is one icon set
 * for the whole product rather than a phone-shaped copy that would be right on
 * the day it was written and wrong a year later. On an icon set that drift is
 * not cosmetic: it means a button wearing the mark of a different action.
 *
 * TEXT GLYPHS ARE NOT AN OPTION and that is what this file replaces. A "✓" or a
 * "🗑" in a Text element is whatever the handset's font decides - a different
 * weight from the icon beside it, a colour emoji on one phone and a line
 * drawing on another - and the design language's whole assortment rule is that
 * icons agree with each other because they were drawn to.
 */

/** The optical size every mark is drawn at, unless a call site says otherwise.
 *  ONE size: three buttons in a column wearing three visibly different icons is
 *  what a shared measure exists to prevent. */
export const GLYPH = 16;

/**
 * One of the app's own marks, in the colour the surrounding text is using.
 *
 * `color` rather than a fill baked into the drawing, because these are the
 * app's own vocabulary: the same tick is ink on a card and contrast-ink on a
 * filled button, and a drawing that carried its own colour could be only one of
 * the two.
 */
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
  /** A box that is not square, for the one place a mark is given room to be
   *  wide. Both default to `size`, which is every other place. */
  width?: number;
  height?: number;
}) {
  const glyph = GLYPHS[name];
  if (!glyph) return null;
  return <Drawn glyph={glyph} color={color} width={width ?? size} height={height ?? size} />;
}

/**
 * A drawing on the app's grid, in one ink.
 *
 * Split out of `Glyph` so a mark that is NOT in the app's own set can still be
 * drawn the same way - the two donation marks, which are brands and therefore
 * deliberately unreachable through the rule table.
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
                // The one stroked mark in the set keeps its stroke and takes no
                // fill; everything else is a filled shape with the even-odd
                // rule, which is how the source set was drawn.
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
 * A brand mark: somebody else's drawing, reproduced rather than redrawn.
 *
 * Rendered through SvgXml because these are not one set on one grid. They carry
 * gradients, clip paths and nested groups, and a hand-written converter that
 * understood only what today's fifty-five happen to use would silently drop
 * part of the fifty-sixth. The markup travels whole and react-native-svg parses
 * it, which is the same contract the browser has.
 *
 * `scheme` picks the colour for marks that cannot be read on one of the two
 * grounds - a black wordmark on a dark page. Fourteen of them carry a second
 * colour for exactly that, and the stylesheet the web reads them through
 * already held the swap.
 */
export function BrandMark({
  name,
  size = 20,
  width,
  height,
  scheme,
}: {
  name: string;
  size?: number;
  /**
   * A box wider than it is tall, where the mark is given the room.
   *
   * An svg letterboxes inside its element, so a square box is a cap on the
   * LONGER side: Linkbox is 5.3:1, Gofile 3.5, Quatrix 3.1, and a 48px square
   * draws the first of those nine pixels tall. The web tile hands each mark a
   * 96 by 48 box for exactly that reason and this is the same box.
   */
  width?: number;
  height?: number;
  scheme: "dark" | "light";
}) {
  const brand = BRANDS[name];
  if (!brand) return null;
  return <SvgXml xml={whole(brand, scheme)} width={width ?? size} height={height ?? size} />;
}

/**
 * A drawing carried whole, as the XML a parser wants.
 *
 * The colours a mark carries INSIDE its own drawing are filled in here, because
 * here is the first place the theme is known. Three logos drew as nothing at all
 * while these were still `var(--brand-putio-1)`: a browser reads that out of the
 * stylesheet, and an SVG parser reads it as a colour it has never heard of and
 * paints with it anyway.
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
 * A coin's own logo, for the crypto window's tiles.
 *
 * Somebody else's drawing again, so it travels the same way a brand mark does
 * and is drawn by the same parser. It is NOT reachable through `glyphNameFor`
 * and never will be: a rule keyed on "crypto" would put a Bitcoin symbol on
 * settings that have nothing to do with it, so a coin mark is passed explicitly
 * at the one call site that means it.
 *
 * Nothing where the id is unknown, which is the designed answer rather than a
 * gap: the tile still carries its ticker, and a symbol that means the wrong coin
 * is worse than none. The test beside lib/donate.ts holds every offered coin to
 * having a mark, so this is a backstop rather than a plan.
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
 * The mark on a donation button: Buy Me a Coffee, PayPal, or the Bitcoin disc
 * for the crypto window.
 *
 * Passed explicitly at the three call sites that mean them and NEVER reachable
 * through `glyphNameFor`, which is the house rule for a brand: a pattern keyed
 * on "coffee" would put a company's cup on anything mentioning coffee, and one
 * on "crypto" would put the Bitcoin symbol on settings that have nothing to do
 * with it.
 *
 * The coffee and PayPal marks take the button's INK, because each rides beside
 * its own label on a filled button and is part of that label - neither carries
 * a ground of its own. Bitcoin is the disc from the coin set and keeps its own
 * orange, the way it does on the tile.
 */
export function DonateMark({
  name,
  color,
  size = GLYPH,
  scheme,
}: {
  name: "coffee" | "paypal" | "bitcoin";
  color: string;
  size?: number;
  scheme: "dark" | "light";
}) {
  if (name === "bitcoin") return <CoinMark coin="btc" size={size} scheme={scheme} />;
  const glyph = DONATE_GLYPHS[name === "coffee" ? "IconBuyMeACoffee" : "IconPayPal"];
  if (!glyph) return null;
  return <Drawn glyph={glyph} color={color} width={size} height={size} />;
}

/** Whether a brand mark of that name exists, so a row can decide to show its
 *  name instead rather than leaving a gap where a logo should be. */
export function hasBrandMark(name: string | undefined): boolean {
  return !!name && name in BRANDS;
}

/**
 * The mark for a storage provider, whichever kind it is.
 *
 * A provider's `mark` names either somebody else's logo or one of the app's own
 * glyphs - a plain folder for a local path, a server for SFTP - and the picker
 * should not have to know which. The two are drawn differently: a brand carries
 * its own colour and must not be recoloured, and an app glyph takes the ink
 * around it.
 *
 * Nothing at all where the name is unknown, and that is the designed answer
 * rather than a gap: several providers deliberately have no mark, because a
 * logo naming the WRONG service is worse than none. The row shows its name
 * instead, which it was going to do anyway.
 */
export function ProviderMark({
  name,
  size = 20,
  width,
  height,
  color,
  scheme,
}: {
  name: string | undefined;
  size?: number;
  /** A box that is not square, for a tile that gives a wordmark its width. */
  width?: number;
  height?: number;
  /** The ink for an app glyph. Ignored by a brand, which owns its colour. */
  color: string;
  scheme: "dark" | "light";
}) {
  if (!name) return null;
  if (name in BRANDS)
    return <BrandMark name={name} size={size} width={width} height={height} scheme={scheme} />;
  if (name in GLYPHS)
    return <Glyph name={name} color={color} size={size} width={width} height={height} />;
  return null;
}

/** Whether a provider has any mark at all, so a tile can decide whether it
 *  still needs to print its name in the mode that shows only symbols. */
export function hasMark(name: string | undefined): boolean {
  return !!name && (name in BRANDS || name in GLYPHS);
}
