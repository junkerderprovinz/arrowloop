// ---------------------------------------------------------------------------
// The marks the donation card and the crypto window wear ([3554]).
//
// BRAND MARKS, and that is why they live here rather than in glyphs.tsx: the
// house rule is that a brand is passed explicitly at the one call site that
// means it and is NEVER reachable by pattern. A glyphFor rule keyed on "coffee"
// would put another company's cup on anything mentioning coffee, and a rule on
// "crypto" would put the Bitcoin symbol on settings that have nothing to do
// with it. See gen_glyphs.py's IconGithub entry for the full reasoning.
//
// They also travel with lib/donate.ts rather than with the action glyphs,
// because that is what they belong to: the day the donation routes change,
// these change with them, and nothing else in the app reads this file.
//
// Attribution, required by the licences:
//   cryptocurrency-icons (https://github.com/spothq/cryptocurrency-icons) -
//   MIT: the coin discs and their symbols. Copyright (c) 2018 Christopher
//   Downer.
//   Simple Icons (https://simpleicons.org) - CC0 1.0 Universal: Sui, Buy Me a
//   Coffee, PayPal.
//
// THE COINS CARRY THEIR OWN COLOURS. jdp: "Bitte fuege bei den Kryptos die
// originalen logos ein." They used to be monochrome silhouettes filling with
// `currentColor` like every other symbol in the app, which was consistent and
// told somebody scanning a grid of eight coins nothing at all - the whole
// point of a coin mark is that Bitcoin's orange is recognised before the
// ticker beside it is read.
//
// What makes that safe here and not elsewhere is the DISC. Each of these is a
// filled circle in the brand's colour with a white symbol on it, so the mark
// brings its own ground: the contrast that decides whether the logo can be
// read is the white against the disc, which is the brand's own number and the
// same on any tile. That is a different question from the one the provider
// marks answer, where a single-ink wordmark has nothing but the tile behind it
// and genuinely disappears - see brandGlyphs.css.
//
// The two whose ground is BLACK are the exception, and donateMarks.css says
// why: XRP and Solana wear the inverted lockup their own brands publish for a
// dark background, rather than a disc that vanishes into the tile.
//
// PayPal and Buy Me a Coffee stay monochrome. They are not coins and they are
// not on a grid: each sits beside its own label on a filled button, where a
// glyph is part of the label and takes the label's ink like every other glyph
// on every other button in the app. Neither mark carries a disc to stand on,
// and PayPal's navy measures 1.03 against that button.
// ---------------------------------------------------------------------------
import type { ReactNode } from "react";

function Mark({ box, d, size = 16 }: { box: string; d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={box}
      fill="currentColor"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const B24 = "0 0 24 24";

/** The frame every coin disc is drawn in. `fill="none"` so an unfilled shape
 *  stays unfilled rather than inheriting the tile's ink. */
function Coin({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const COINS: Record<string, ReactNode> = {
  btc: (
    <>
      <circle cx="16" cy="16" r="16" fill="#F7931A" />
      <path
        fill="#FFF"
        fillRule="nonzero"
        d="M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.538c-.533 2.147-4.148.986-5.32.695l.95-3.805c1.172.293 4.929.872 4.37 3.11zm.535-5.569c-.487 1.953-3.495.96-4.47.717l.86-3.45c.975.243 4.118.696 3.61 2.733z"
      />
    </>
  ),
  eth: (
    <>
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      {/* Ethereum's own mark is one shape in three tones of white, and the
          faces are what make it read as a solid rather than a flat diamond.
          Flattening them to one opacity would be redrawing the logo. */}
      <g fill="#FFF" fillRule="nonzero">
        <path fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z" />
        <path d="M16.498 4L9 16.22l7.498-3.35z" />
        <path fillOpacity=".602" d="M16.498 21.968v6.027L24 17.616z" />
        <path d="M16.498 27.995v-6.028L9 17.616z" />
        <path fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497-3.348z" />
        <path fillOpacity=".602" d="M9 16.22l7.498 4.353v-7.701z" />
      </g>
    </>
  ),
  usdt: (
    <>
      <circle cx="16" cy="16" r="16" fill="#26A17B" />
      <path
        fill="#FFF"
        d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658 0-.809 2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V7.819H8.595v3.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118 0 1.044 3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117"
      />
    </>
  ),
  usdc: (
    <>
      {/* #2775CA, not the #3E73C4 the icon set ships. Circle changed its blue
          when it rebranded and the set has not been touched since 2021; the
          symbol is theirs, the colour is Circle's own current one. */}
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <g fill="#FFF">
        <path d="M20.022 18.124c0-2.124-1.28-2.852-3.84-3.156-1.828-.243-2.193-.728-2.193-1.578 0-.85.61-1.396 1.828-1.396 1.097 0 1.707.364 2.011 1.275a.458.458 0 00.427.303h.975a.416.416 0 00.427-.425v-.06a3.04 3.04 0 00-2.743-2.489V9.142c0-.243-.183-.425-.487-.486h-.915c-.243 0-.426.182-.487.486v1.396c-1.829.242-2.986 1.456-2.986 2.974 0 2.002 1.218 2.791 3.778 3.095 1.707.303 2.255.668 2.255 1.639 0 .97-.853 1.638-2.011 1.638-1.585 0-2.133-.667-2.316-1.578-.06-.242-.244-.364-.427-.364h-1.036a.416.416 0 00-.426.425v.06c.243 1.518 1.219 2.61 3.23 2.914v1.457c0 .242.183.425.487.485h.915c.243 0 .426-.182.487-.485V21.34c1.829-.303 3.047-1.578 3.047-3.217z" />
        <path d="M12.892 24.497c-4.754-1.7-7.192-6.98-5.424-11.653.914-2.55 2.925-4.491 5.424-5.402.244-.121.365-.303.365-.607v-.85c0-.242-.121-.424-.365-.485-.061 0-.183 0-.244.06a10.895 10.895 0 00-7.13 13.717c1.096 3.4 3.717 6.01 7.13 7.102.244.121.488 0 .548-.243.061-.06.061-.122.061-.243v-.85c0-.182-.182-.424-.365-.546zm6.46-18.936c-.244-.122-.488 0-.548.242-.061.061-.061.122-.061.243v.85c0 .243.182.485.365.607 4.754 1.7 7.192 6.98 5.424 11.653-.914 2.55-2.925 4.491-5.424 5.402-.244.121-.365.303-.365.607v.85c0 .242.121.424.365.485.061 0 .183 0 .244-.06a10.895 10.895 0 007.13-13.717c-1.096-3.46-3.778-6.07-7.13-7.162z" />
      </g>
    </>
  ),
  bnb: (
    <>
      <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
      <path
        fill="#FFF"
        d="M12.116 14.404L16 10.52l3.886 3.886 2.26-2.26L16 6l-6.144 6.144 2.26 2.26zM6 16l2.26-2.26L10.52 16l-2.26 2.26L6 16zm6.116 1.596L16 21.48l3.886-3.886 2.26 2.259L16 26l-6.144-6.144-.003-.003 2.263-2.257zM21.48 16l2.26-2.26L26 16l-2.26 2.26L21.48 16zm-3.188-.002h.002V16L16 18.294l-2.291-2.29-.004-.004.004-.003.401-.402.195-.195L16 13.706l2.293 2.293z"
      />
    </>
  ),
  sol: (
    <>
      {/* Solana's ground is black, so the disc follows the theme - see
          donateMarks.css. The bars keep the brand gradient on either, which is
          the part of this logo people actually recognise. */}
      <circle cx="16" cy="16" r="16" fill="var(--coin-sol-disc)" />
      <defs>
        <linearGradient id="coin-sol-bars" x1="8" y1="23" x2="24" y2="9">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path
        fill="url(#coin-sol-bars)"
        d="M9.925 19.687a.59.59 0 01.415-.17h14.366a.29.29 0 01.207.497l-2.838 2.815a.59.59 0 01-.415.171H7.294a.291.291 0 01-.207-.498l2.838-2.815zm0-10.517A.59.59 0 0110.34 9h14.366c.261 0 .392.314.207.498l-2.838 2.815a.59.59 0 01-.415.17H7.294a.291.291 0 01-.207-.497L9.925 9.17zm12.15 5.225a.59.59 0 00-.415-.17H7.294a.291.291 0 00-.207.498l2.838 2.815c.11.109.26.17.415.17h14.366a.291.291 0 00.207-.498l-2.838-2.815z"
      />
    </>
  ),
  sui: (
    <>
      {/* The one disc composed here rather than taken from the set: the icon
          set predates Sui and has no file for it. The disc is Sui's own blue
          and the droplet is their mark, scaled from its 24 box and centred -
          which is the lockup Sui themselves publish as the token icon. */}
      <circle cx="16" cy="16" r="16" fill="#4DA2FF" />
      <g transform="translate(8.56 8.56) scale(0.62)">
        <path
          fill="#FFF"
          d="M17.636 10.009a7.16 7.16 0 0 1 1.565 4.474 7.2 7.2 0 0 1-1.608 4.53l-.087.106-.023-.135a7 7 0 0 0-.07-.349c-.502-2.21-2.142-4.106-4.84-5.642-1.823-1.034-2.866-2.278-3.14-3.693-.177-.915-.046-1.834.209-2.62.254-.787.631-1.446.953-1.843l1.05-1.284a.46.46 0 0 1 .713 0l5.28 6.456zm1.66-1.283L12.26.123a.336.336 0 0 0-.52 0L4.704 8.726l-.023.029a9.33 9.33 0 0 0-2.07 5.872C2.612 19.803 6.816 24 12 24s9.388-4.197 9.388-9.373a9.32 9.32 0 0 0-2.07-5.871zM6.389 9.981l.63-.77.018.142q.023.17.055.34c.408 2.136 1.862 3.917 4.294 5.297 2.114 1.203 3.345 2.586 3.7 4.103a5.3 5.3 0 0 1 .109 1.801l-.004.034-.03.014A7.2 7.2 0 0 1 12 21.67c-3.976 0-7.2-3.218-7.2-7.188 0-1.705.594-3.27 1.587-4.503z"
        />
      </g>
    </>
  ),
  xrp: (
    <>
      {/* The current XRP mark, not Ripple's old wave lines: those are the
          COMPANY's former logo and read as a set of brackets at 22px, which
          is exactly how it was reported ("das logo von XRP passt nicht").
          Disc and ink both follow the theme - see donateMarks.css. */}
      <circle cx="16" cy="16" r="16" fill="var(--coin-xrp-disc)" />
      <path
        fill="var(--coin-xrp-ink)"
        d="M23.07 8h2.89l-6.015 5.957a5.621 5.621 0 01-7.89 0L6.035 8H8.93l4.57 4.523a3.556 3.556 0 004.996 0L23.07 8zM8.895 24.563H6l6.055-5.993a5.621 5.621 0 017.89 0L26 24.562h-2.895L18.5 20a3.556 3.556 0 00-4.996 0l-4.61 4.563z"
      />
    </>
  ),
};

/**
 * PayPal's own mark, for the button that opens a PayPal.Me page.
 *
 * The same rule as every brand here: passed explicitly at the one call site
 * that means it, never reachable by pattern.
 */
export function IconPayPal({ size = 16 }: { size?: number }): ReactNode {
  return (
    <Mark
      box={B24}
      size={size}
      d="M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z"
    />
  );
}

/** Whether a coin id has a mark here. The test beside lib/donate.ts holds
 *  every offered coin to having one, so no tile ships as a bare ticker. */
export function hasCoinMark(coin: string): boolean {
  return coin in COINS;
}

/** A coin's own logo, by the id lib/donate.ts gives it. */
export function CoinMark({ coin, size = 16 }: { coin: string; size?: number }): ReactNode {
  const body = COINS[coin];
  // Undefined rather than a placeholder: a tile still carries its ticker, and
  // a symbol that means nothing is worse than none. The test beside donate.ts
  // holds every offered coin to having one, so this is a backstop, not a plan.
  if (!body) return null;
  return <Coin size={size}>{body}</Coin>;
}

/**
 * Buy Me a Coffee's own mark, for the button that opens their page.
 *
 * The same rule as the GitHub mark on the repository button: a brand is
 * recognised faster than a word is read, and it belongs only on the control
 * that actually goes there.
 */
export function IconBuyMeACoffee({ size = 16 }: { size?: number }): ReactNode {
  return (
    <Mark
      box={B24}
      size={size}
      d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.013-.322-3.094c-.037-.351-.286-.695-.678-.678-.336.015-.718.3-.678.679l.228 2.185.949 9.112c.147 1.344 1.174 2.068 2.446 2.272.742.12 1.503.144 2.257.156.966.016 1.942.053 2.892-.122 1.408-.258 2.465-1.198 2.616-2.657.34-3.332.683-6.663 1.024-9.995l.215-2.087a.484.484 0 01.39-.426c.402-.078.787-.212 1.074-.518.455-.488.546-1.124.385-1.766zm-1.478.772c-.145.137-.363.201-.578.233-2.416.359-4.866.54-7.308.46-1.748-.06-3.477-.254-5.207-.498-.17-.024-.353-.055-.47-.18-.22-.236-.111-.71-.054-.995.052-.26.152-.609.463-.646.484-.057 1.046.148 1.526.22.577.088 1.156.159 1.737.212 2.48.226 5.002.19 7.472-.14.45-.06.899-.13 1.345-.21.399-.072.84-.206 1.08.206.166.281.188.657.162.974a.544.544 0 01-.169.364zm-6.159 3.9c-.862.37-1.84.788-3.109.788a5.884 5.884 0 01-1.569-.217l.877 9.004c.065.78.717 1.38 1.5 1.38 0 0 1.243.065 1.658.065.447 0 1.786-.065 1.786-.065.783 0 1.434-.6 1.499-1.38l.94-9.95a3.996 3.996 0 00-1.322-.238c-.826 0-1.491.284-2.26.613z"
    />
  );
}

/**
 * Bitcoin's mark, on the button that opens the crypto window.
 *
 * jdp asked for it by name (2026-09-10). It is the one symbol that reads as
 * "crypto" to somebody who has never held any - the way a floppy disk still
 * reads as "save" - and that is worth more here than the accuracy of naming
 * one chain out of five. What keeps the naming honest is the window itself:
 * the first thing in it is a grid of every coin on offer, each with its own
 * mark, so nobody gets as far as an address believing Bitcoin is the only
 * option. This replaced a neutral wallet drawing, which was correct and said
 * nothing.
 *
 * In colour, like the coins in that window. It is the same disc on a button
 * one step lighter, where it measures 2.19 against the fill and 2.31 under the
 * pointer - and a coloured Bitcoin beside a monochrome PayPal is not an
 * inconsistency, it is the difference between a mark that carries its own
 * ground and one that does not.
 */
export function IconBitcoin({ size = 16 }: { size?: number }): ReactNode {
  return <CoinMark coin="btc" size={size} />;
}
