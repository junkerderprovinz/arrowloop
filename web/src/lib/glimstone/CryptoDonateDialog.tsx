// The window for giving from a crypto wallet.
//
// Every network a donor can pick carries its own address, so a chain the
// recipient cannot receive on cannot be offered: one 0x address listed under
// "Tether" beside Tron would lose the money of anyone who picked Tron. The donor
// picks the coin first and the chain second, each in its own row. The address
// sits above the picker, since it is what the window is opened for.
//
// The component holds no state and touches no `document`; the app owns the
// selection, Escape, the portal and the toast. `renderQr` and `renderMark` are
// props because a QR code needs a library and a coin's mark is someone else's
// brand; without them the window shows the address, a copy button and tickers.
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
   *  before sending. Already translated. */
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
  /** Picking a coin lands on that coin's first network rather than keeping the
   *  previous chain, which the donor never checked against the new coin. */
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
  /** Copy the address and say so in a toast, in the app's own words. */
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
  // `reactive` shows both mark and ticker here: somebody searching a grid of
  // coins should not have to hover every tile to find USDT.
  const mode = useLabelMode("buttons");
  const showMark = mode !== "text";
  const showTicker = mode !== "glyph";
  return (
    <div
      className="glim-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
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
        {/* Rule 15: the title is a badge straddling the top edge. No corner X,
            since the footer already closes the window. */}
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <h2 id="cryptodonate-title" className="flex items-center">
            <Badge tone="heading" size="heading" wrap>
              {text.title}
            </Badge>
          </h2>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
          <p className="text-sm text-carbon-textSub">{text.intro}</p>

          <div className="flex flex-col items-center gap-3 rounded-card bg-carbon-surface2 p-4">
            {renderQr?.(network.address)}
            {/* Never shortened, since an address is checked by eye before
                sending. `dir="ltr"` keeps it left-to-right in a right-to-left
                interface. */}
            <p dir="ltr" className="w-full break-all text-center font-mono text-xs text-carbon-text">
              {network.address}
            </p>
            {/* The chain row sits directly under the address it changes, and
                shows even for a coin with one chain because it also says which
                network the address belongs to. Chain names stay words in every
                label mode; each chain owns a rainbow position. */}
            <div className="flex flex-wrap justify-center gap-2" role="listbox" aria-label={text.networks}>
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
            {/* Warn-coloured so a donor looking for a memo or destination tag
                finds it next to the address. */}
            {network.note && <p className="text-center text-xs text-statusWarn">{network.note}</p>}
            {/* Takes the coin's rainbow position, so in rainbow mode it matches
                the tile the address came from. */}
            <Button
              label={text.copyLabel}
              labelKey="common.copy"
              tone="accent"
              hueIndex={coins.findIndex((c) => c.id === coin.id)}
              onClick={() => onCopy(coin, network)}
            />
          </div>

          {/* Tiles, because a coin is recognised by its mark faster than its
              name is read. `.glim-hue-icon` tints the mark while the ticker is
              shown and is dropped in glyph mode, where only the fill of an
              icon-only tile carries colour. */}
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
