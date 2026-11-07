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
import { hueVars } from "../appearance.ts";
import { Badge } from "./Badge.tsx";
import { Button } from "./Button.tsx";
import { useLabelMode } from "./useLabelMode.ts";

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
  /** The coin's own colour and the ink that holds on it, which its tile lights
   *  up in under the pointer ("Brand tiles"). The picked coin keeps the accent. */
  tile?: { color: string; ink: string };
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
    /** The app's appeal, the same in every giving window. */
    appeal: string;
    /** One sentence saying what to do: pick a currency and a network, then scan
     *  or copy. */
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
      className="glim-modal-backdrop"
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
        className="glim-modal-card glim-modal-card--wide"
      >
        {/* Rule 15: the title is a badge straddling the top edge. No corner X,
            since the footer already closes the window. */}
        <div className="glim-modal-head">
          <h2 id="cryptodonate-title" className="glim-modal-title">
            <Badge tone="heading" size="heading" wrap>
              {text.title}
            </Badge>
          </h2>
        </div>

        <div className="glim-give-body glim-give-body--scroll">
          <p className="glim-give-appeal">{text.appeal}</p>
          <p className="glim-give-intro">{text.intro}</p>

          <div className="glim-give-well">
            {renderQr?.(network.address)}
            {/* Never shortened, since an address is checked by eye before
                sending. `dir="ltr"` keeps it left-to-right in a right-to-left
                interface. */}
            <p dir="ltr" className="glim-give-address">
              {network.address}
            </p>
            {/* The chain row sits directly under the address it changes, and
                shows even for a coin with one chain because it also says which
                network the address belongs to. Chain names stay words in every
                label mode; each chain owns a rainbow position. */}
            <div className="glim-give-networks" role="listbox" aria-label={text.networks}>
              {coin.networks.map((n, i) => (
                <button
                  key={n.id}
                  type="button"
                  role="option"
                  aria-selected={n.id === network.id}
                  onClick={() => onPick(coin, n)}
                  style={hueVars(i) as CSSProperties}
                  className={`glim-give-network glim-hue${n.id === network.id ? " glim-active" : ""}`}
                >
                  {n.name}
                </button>
              ))}
            </div>
            {network.note && <p className="glim-give-note">{network.note}</p>}
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

          {/* `.glim-hue-icon` tints the mark while the ticker is shown and is
              dropped in glyph mode, where only the fill of an icon-only tile
              carries colour. */}
          <div className="glim-give-coins" role="listbox" aria-label={text.title}>
            {coins.map((c, i) => {
              const picked = c.id === coin.id;
              const lit = !picked && c.tile;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={picked}
                  aria-label={`${c.name} (${c.symbol})`}
                  title={c.name}
                  onClick={() => onPick(c, c.networks[0]!)}
                  style={
                    {
                      ...hueVars(i),
                      ...(lit && { "--tile": c.tile!.color, "--tile-ink": c.tile!.ink }),
                    } as CSSProperties
                  }
                  className={`glim-give-coin ${showTicker ? "glim-hue glim-hue-icon" : "glim-hue"} ${
                    picked ? "glim-active" : lit ? "glim-brand-tile" : "glim-give-coin--plain"
                  }`}
                >
                  {showMark && renderMark?.(c)}
                  {showTicker && <span className="glim-give-ticker">{c.symbol}</span>}
                </button>
              );
            })}
          </div>

        </div>

        <div className="glim-give-foot">
          <Button label={text.closeLabel} labelKey="common.close" tone="neutral" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
