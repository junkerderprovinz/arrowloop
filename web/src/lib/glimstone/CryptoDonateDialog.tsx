// ---------------------------------------------------------------------------
// CryptoDonateDialog — the house's second way to give.
//
// The coffee button takes a card. This takes what somebody already holds in a
// wallet: it shows no name at either end, needs no account, reaches nobody's
// server, and works in a country where the card route does not. Two buttons
// under one sentence, because they reach two different people.
//
// THE ONE RULE THIS COMPONENT EXISTS TO ENFORCE: the list is grouped BY CHAIN
// and never by coin. Written the other way round first, it named "Tether" over
// the networks "BNB, Tron, Solana, Ethereum" above a single 0x… address. That
// address lives on EVM chains only. A donor picking Tron would have sent the
// money into nothing, and nobody would ever have reported it: the person it
// happens to is not a user, they are a stranger who tried to give something
// away and never writes. Grouped by chain, the wrong choice is not on offer.
// A coin whose chain has no address is simply absent from the list.
//
// The address is offered THREE times over, and that is also deliberate: as
// text for a desktop wallet, as a QR for a phone, and as a copy button for
// whoever trusts neither their eyes nor their camera. Whichever a donor has,
// they use.
//
// Pure and hookless, the same split as ConfirmDialog/useConfirm: props in, an
// element tree out, no `document` and no state. The app owns which chain is
// picked, Escape, the portal and the toast — exactly the parts a design
// language cannot know about.
//
// `renderQr` is a prop for the same reason: drawing a QR code needs a library,
// and this file has no dependencies and is not going to grow one. The app
// already has an encoder (an authenticator secret needs the same square) and
// passes it in. An app with none passes nothing, and the window falls back to
// address-and-copy, which is still a complete way to give.
// ---------------------------------------------------------------------------
import type { ReactNode, Ref } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";

export interface CryptoChain {
  /** Stable id, for the copy toast and for the app's own tests. */
  id: string;
  /** What the donor picks: the CHAIN, never the coin. */
  name: string;
  /** What can be sent to this address, as a subtitle ("ETH · USDT · USDC"). */
  coins: string;
  /** The networks this one address is valid on, where more than one applies.
   *  Every network named here must actually accept this address format — this
   *  line is the last place a wrong chain could still sneak back in. */
  networks?: string;
  address: string;
  /** One short line shown with the address, for what a donor has to know
   *  before sending. Already translated: the language owns no strings. */
  note?: string;
}

export interface CryptoDonateDialogProps {
  /** The addresses, grouped by chain. See the rule at the top of this file. */
  chains: CryptoChain[];
  /** The chain currently shown. The app owns this, so it can remember it. */
  picked: CryptoChain;
  onPick: (chain: CryptoChain) => void;
  text: {
    title: string;
    /** One sentence saying what to do: pick a chain, then scan or copy. */
    intro: string;
    /** The label in front of a chain's `networks` line ("Networks"). */
    networks: string;
    copyLabel: string;
    closeLabel: string;
  };
  /** The address as a scannable square. Omit it and the window shows the
   *  address and the copy button alone. */
  renderQr?: (value: string) => ReactNode;
  /** Copy the address and say so — a toast, in the app's own words. The window
   *  does not touch the clipboard itself, because "copied" is a message and
   *  messages are the app's. */
  onCopy: (chain: CryptoChain) => void;
  onClose: () => void;
  /** The window's own card, for the app's Escape handling and focus trap. */
  ref?: Ref<HTMLDivElement>;
}

export function CryptoDonateDialog({
  chains,
  picked,
  onPick,
  text,
  renderQr,
  onCopy,
  onClose,
  ref,
}: CryptoDonateDialogProps) {
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

          {/* Each row is a button because it does something, and the picked one
              is FILLED with the accent — the same mark every chosen thing in
              this language wears. Not a dropdown: five chains is a list
              somebody reads, and a closed picker would hide the very choice
              this window exists to put in front of them. */}
          <div className="flex flex-col gap-1" role="listbox" aria-label={text.title}>
            {chains.map((chain) => (
              <button
                key={chain.id}
                type="button"
                role="option"
                aria-selected={chain.id === picked.id}
                onClick={() => onPick(chain)}
                className={`flex items-baseline gap-2 rounded-control px-3 py-2 text-start transition-colors ${
                  chain.id === picked.id
                    ? "bg-accent text-accentContrast"
                    : "text-carbon-textSub hover:bg-carbon-hover hover:text-carbon-text"
                }`}
              >
                <span className="font-medium">{chain.name}</span>
                <span className="text-xs opacity-80">{chain.coins}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col items-center gap-3 rounded-card bg-carbon-surface2 p-4">
            {renderQr?.(picked.address)}
            {/* Whole, in one piece, in a mono face, and never shortened. An
                address is read back by eye before somebody sends to it, so an
                ellipsis in the middle turns the one string that has to be
                exact into a string nobody can check. `dir="ltr"` because it
                stays left-to-right in a right-to-left interface. */}
            <p dir="ltr" className="w-full break-all text-center font-mono text-xs text-carbon-text">
              {picked.address}
            </p>
            {picked.networks && (
              <p className="text-center text-xs text-carbon-textMuted">
                {text.networks}: {picked.networks}
              </p>
            )}
            {/* Warn-coloured, and that is not a warning: it is the line a donor
                would otherwise go hunting for. Exchanges train people to look
                for a destination tag or a memo, so the chain that does not
                want one has to say so where the address is. */}
            {picked.note && <p className="text-center text-xs text-statusWarn">{picked.note}</p>}
            <Button
              label={text.copyLabel}
              labelKey="common.copy"
              tone="accent"
              onClick={() => onCopy(picked)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button label={text.closeLabel} labelKey="common.close" tone="neutral" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
