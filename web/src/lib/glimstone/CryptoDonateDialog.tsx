// ---------------------------------------------------------------------------
// CryptoDonateDialog — the house's second way to give.
//
// The coffee button takes a card. This takes what somebody already holds in a
// wallet: it shows no name at either end, needs no account, reaches nobody's
// server, and works in a country where the card route does not. Two buttons
// under one sentence, because they reach two different people.
//
// THE RULE THIS COMPONENT EXISTS TO ENFORCE: every network a donor can pick
// carries its OWN address. There is no line anywhere naming a chain without a
// wallet behind it, so a chain the recipient cannot receive on is unofferable
// rather than merely discouraged.
//
// That rule was bought at the price of nearly shipping its opposite. The list
// was first written grouped by COIN, with a row "Tether" over the networks
// "BNB, Tron, Solana, Ethereum" and a single 0x… address underneath. That
// address lives on EVM chains only. A donor picking Tron would have sent the
// money into nothing, and nobody would ever have reported it: the person it
// happens to is not a user, they are a stranger who tried to give something
// away and never writes. A coin whose chain has no address is simply absent
// from the list, however popular it is.
//
// Coin first, chain second, and both are real choices. A donor thinks "I have
// USDT", not "I have Ethereum", so the first question is the one they can
// answer; the second question is the dangerous one and gets its own row rather
// than being folded into a subtitle nobody reads.
//
// THE ANSWER COMES BEFORE THE QUESTION. The code sits at the top and the
// picker underneath it. A dialog usually asks before it answers, and this one
// is the other way round because the code is what the window was opened for:
// the picker changes it in place, so the thing somebody came to scan never
// moves off the top of the window.
//
// Pure and hookless, the same split as ConfirmDialog/useConfirm: props in, an
// element tree out, no `document` and no state. The app owns which coin is
// picked, Escape, the portal and the toast — exactly the parts a design
// language cannot know about.
//
// `renderQr` and `renderMark` are props for the same reason: drawing a QR code
// needs a library and a coin's mark is a BRAND, and this file has neither
// dependencies nor a right to hand out somebody else's logo. The app passes
// both in. Without them the window falls back to address-and-copy over plain
// tickers, which is still a complete way to give.
// ---------------------------------------------------------------------------
import type { CSSProperties, ReactNode, Ref } from "react";
import { hueVars, rainbowAt } from "../appearance";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { useLabelMode } from "./useLabelMode";

/** One address, and the chain it lives on. */
export interface CryptoNetwork {
  /** Stable id, for the copy toast and for the app's own tests. */
  id: string;
  /** The chain as a donor's wallet names it. */
  name: string;
  address: string;
  /** One short line shown with the address, for what a donor has to know
   *  before sending. Already translated: the language owns no strings. */
  note?: string;
}

/** One coin, and every chain it can be sent on. */
export interface CryptoCoin {
  /** Stable id, and the key `renderMark` draws by. */
  id: string;
  /** The ticker, on the tile under the mark. */
  symbol: string;
  /** The full name, for the accessible label. */
  name: string;
  /** Never empty, and every entry carries an address. */
  networks: CryptoNetwork[];
}

export interface CryptoDonateDialogProps {
  /** The coins on offer. See the rule at the top of this file. */
  coins: CryptoCoin[];
  /** What is shown right now. The app owns this, so it can remember it. */
  coin: CryptoCoin;
  network: CryptoNetwork;
  /** Picking a coin must land on a network of THAT coin — keeping the previous
   *  chain when it happens to also carry the new coin is a convenience with one
   *  bad case: a chain somebody last looked at staying selected under a coin
   *  they never checked it against. */
  onPick: (coin: CryptoCoin, network: CryptoNetwork) => void;
  text: {
    title: string;
    /** One sentence saying what to do: pick a coin and a network, then scan or
     *  copy. */
    intro: string;
    /** The label over the chain row ("Networks"). */
    networks: string;
    copyLabel: string;
    closeLabel: string;
  };
  /** The address as a scannable square. */
  renderQr?: (value: string) => ReactNode;
  /** A coin's own mark. */
  renderMark?: (coin: CryptoCoin) => ReactNode;
  /** Copy the address and say so — a toast, in the app's own words. The window
   *  does not touch the clipboard itself, because "copied" is a message and
   *  messages are the app's. */
  onCopy: (coin: CryptoCoin, network: CryptoNetwork) => void;
  onClose: () => void;
  /** The window's own card, for the app's Escape handling and focus trap. */
  ref?: Ref<HTMLDivElement>;
}

export function CryptoDonateDialog({
  coins,
  coin,
  network,
  onPick,
  text,
  renderQr,
  renderMark,
  onCopy,
  onClose,
  ref,
}: CryptoDonateDialogProps) {
  // The label engine decides what a tile SHOWS. `reactive` deliberately
  // resolves to the same thing as text-and-glyph HERE and nowhere else:
  // reactive means the words appear under the pointer, which is right for a
  // strip of verbs somebody already knows and wrong for a grid of coins
  // somebody is SEARCHING - it would turn "find USDT" into hovering every tile
  // in turn. A picker is the one surface where hiding the labels until asked
  // defeats the surface.
  const mode = useLabelMode("buttons");
  const showMark = mode !== "text";
  const showTicker = mode !== "glyph";
  return (
    <div
      className="glim-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cryptodonate-title"
        className="glim-modal-card relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-card bg-carbon-surface shadow-2xl"
      >
        {/* Rule 15: a window is a window, and its title is a badge straddling
            the top edge. No corner X — the footer already answers, and one
            answer offered twice reads as two choices. */}
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <h2 id="cryptodonate-title" className="flex items-center">
            <Badge tone="heading" size="heading" wrap>
              {text.title}
            </Badge>
          </h2>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
          <p className="text-sm text-carbon-textSub">{text.intro}</p>

          {/* The answer, first. */}
          <div className="flex flex-col items-center gap-3 rounded-card bg-carbon-surface2 p-4">
            {renderQr?.(network.address)}
            {/* Whole, in one piece, in a mono face, and never shortened. An
                address is read back by eye before somebody sends to it, so an
                ellipsis in the middle turns the one string that has to be
                exact into a string nobody can check. `dir="ltr"` because it
                stays left-to-right in a right-to-left interface. */}
            <p dir="ltr" className="w-full break-all text-center font-mono text-xs text-carbon-text">
              {network.address}
            </p>
            {/* The chain, switched HERE, directly under the address it
                changes (jdp, 2026-09-10). A picker one box away from its own
                effect makes somebody look twice to see whether the address
                moved; a row of chips under it changes the string in front of
                their eyes. Shown even when a coin has only one chain, because
                this is also the line that SAYS which network the address
                belongs to, and that fact may not appear and disappear
                depending on which tile is lit. */}
            <div className="flex flex-wrap justify-center gap-2" role="listbox" aria-label={text.networks}>
              {/* A chain name is DATA and has no symbol, so the label engine
                  has nothing to hide here and these stay words in every mode.
                  The colour engine still applies: each chain owns a position,
                  so the chosen one fills in its own hue. */}
              {coin.networks.map((n, i) => (
                <button
                  key={n.id}
                  type="button"
                  role="option"
                  aria-selected={n.id === network.id}
                  onClick={() => onPick(coin, n)}
                  style={hueVars(rainbowAt(i)) as CSSProperties}
                  className={`glim-hue rounded-pill px-3 py-1 text-xs font-medium transition-colors ${
                    n.id === network.id
                      ? "glim-active bg-accent text-accentContrast"
                      : "bg-carbon-surface3 text-carbon-textSub hover:bg-carbon-hoverRaised hover:text-carbon-text"
                  }`}
                >
                  {n.name}
                </button>
              ))}
            </div>
            {/* Warn-coloured, and that is not a warning: it is the line a donor
                would otherwise go hunting for. Exchanges train people to look
                for a destination tag or a memo, so the chain that does not want
                one has to say so where the address is. */}
            {network.note && <p className="text-center text-xs text-statusWarn">{network.note}</p>}
            {/* The one accent surface in this box, so it takes the position of
                the coin it belongs to: in rainbow mode the copy button is the
                same colour as the tile the address came from. The close button
                below has no position, and that is not an omission - it is
                neutral-toned, and a palette colour on a control that paints no
                accent resolves to nothing. */}
            <Button
              label={text.copyLabel}
              labelKey="common.copy"
              tone="accent"
              hueIndex={coins.findIndex((c) => c.id === coin.id)}
              onClick={() => onCopy(coin, network)}
            />
          </div>

          {/* The picker, under the answer it changes. Tiles rather than a list,
              because a coin is recognised by its mark faster than its name is
              read, and a grid of marks is the one layout that says at a glance
              what is on offer.

              Each tile owns a palette position, so rainbow mode makes the coins
              scannable by colour the way it makes any other list scannable.
              `.glim-hue-icon` tints the mark itself while the ticker sits
              beside it, and is dropped in glyph mode: there the mark IS the
              tile's whole content, and the house rule for an icon-only badge is
              that only the fill ever carries colour. */}
          <div className="grid grid-cols-4 gap-2" role="listbox" aria-label={text.title}>
            {coins.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === coin.id}
                aria-label={`${c.name} (${c.symbol})`}
                title={c.name}
                onClick={() => onPick(c, c.networks[0]!)}
                style={hueVars(rainbowAt(i)) as CSSProperties}
                className={`flex flex-col items-center gap-1 rounded-control px-2 py-3 transition-colors ${
                  showTicker ? "glim-hue glim-hue-icon" : "glim-hue"
                } ${
                  c.id === coin.id
                    ? "glim-active bg-accent text-accentContrast"
                    : "bg-carbon-surface2 text-carbon-textSub hover:bg-carbon-surface3 hover:text-carbon-text"
                }`}
              >
                {showMark && renderMark?.(c)}
                {showTicker && <span className="text-xs font-medium">{c.symbol}</span>}
              </button>
            ))}
          </div>

        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button label={text.closeLabel} labelKey="common.close" tone="neutral" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
