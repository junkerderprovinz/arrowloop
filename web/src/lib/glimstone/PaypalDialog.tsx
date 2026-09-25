// The window for PayPal: how often and how much in the house's own controls,
// then PayPal's two buttons. The PayPal button opens PayPal's login popup; the
// card button opens a card form inside this window, for somebody without a
// PayPal account.
//
// PayPal draws its buttons itself and allows no more than a colour, a radius
// and a height, so the window keeps them apart from the house controls above
// them. Like the other give windows it holds no state: the app owns the
// selection, Escape and the portal, and passes its own horizontal selector in.
import type { ReactNode, Ref, RefObject } from "react";
import type { GiveFrequency } from "../paypal";
import { Badge } from "./Badge";
import { Button } from "./Button";

export interface SelectorProps {
  labelledBy: string;
  options: { value: string; label: string }[];
  /** Null when no segment is picked, as while a typed amount applies. */
  value: string | null;
  onChange: (value: string) => void;
}

export interface PaypalDialogProps {
  text: {
    title: string;
    /** One sentence: the payment happens at PayPal, by account or by card. */
    intro: string;
    frequencyLabel: string;
    frequencies: Record<GiveFrequency, string>;
    amountLabel: string;
    /** Placeholder and accessible name of the free amount. */
    otherAmount: string;
    loading: string;
    thanks: string;
    failed: string;
    closeLabel: string;
  };
  frequency: GiveFrequency;
  onFrequency: (frequency: GiveFrequency) => void;
  /** The preset amounts, as whole numbers in the currency. */
  amounts: string[];
  currencySymbol: string;
  /** The picked preset, or null while the free amount is in use. */
  preset: string | null;
  onPreset: (amount: string) => void;
  typed: string;
  /** Whether `typed` parses as an amount PayPal accepts. */
  typedValid: boolean;
  onTyped: (text: string) => void;
  /** The app's own horizontal selector. */
  renderSelector: (props: SelectorProps) => ReactNode;
  /** From usePaypalButtons. */
  buttonsRef: RefObject<HTMLDivElement | null>;
  status: "idle" | "done" | "failed";
  onClose: () => void;
  /** The window's own card, for the app's Escape handling and focus trap. */
  ref?: Ref<HTMLDivElement>;
}

export function PaypalDialog({
  text,
  frequency,
  onFrequency,
  amounts,
  currencySymbol,
  preset,
  onPreset,
  typed,
  typedValid,
  onTyped,
  renderSelector,
  buttonsRef,
  status,
  onClose,
  ref,
}: PaypalDialogProps) {
  const frequencies: GiveFrequency[] = ["once", "month", "year"];
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
        aria-labelledby="paypal-window-title"
        className="glim-modal-card relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-card bg-carbon-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <h2 id="paypal-window-title" className="flex items-center">
            <Badge tone="heading" size="heading" wrap>
              {text.title}
            </Badge>
          </h2>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
          <p className="text-sm text-carbon-textSub">{text.intro}</p>

          <div className="flex flex-col gap-1.5">
            <span id="paypal-frequency" className="glim-eyebrow text-carbon-textMuted">
              {text.frequencyLabel}
            </span>
            {renderSelector({
              labelledBy: "paypal-frequency",
              options: frequencies.map((f) => ({ value: f, label: text.frequencies[f] })),
              value: frequency,
              onChange: (v) => onFrequency(v as GiveFrequency),
            })}
          </div>

          <div className="flex flex-col gap-1.5">
            <span id="paypal-amount" className="glim-eyebrow text-carbon-textMuted">
              {text.amountLabel}
            </span>
            {/* The free amount sits right of the presets, in the same row, and
                a valid entry takes the selection away from them. */}
            <div className="flex flex-wrap items-center gap-2">
              {renderSelector({
                labelledBy: "paypal-amount",
                options: amounts.map((a) => ({ value: a, label: `${a} ${currencySymbol}` })),
                value: preset,
                onChange: onPreset,
              })}
              <input
                type="text"
                inputMode="decimal"
                value={typed}
                placeholder={text.otherAmount}
                aria-label={text.otherAmount}
                aria-invalid={typed !== "" && !typedValid}
                onChange={(e) => onTyped(e.target.value)}
                className={`h-9 w-36 rounded-control border bg-carbon-surface px-2.5 text-sm text-carbon-text ${
                  typedValid ? "border-accent" : "border-carbon-border"
                }`}
              />
            </div>
          </div>

          {/* PayPal's buttons are cross-origin frames drawn light; with the
              window's dark scheme the browser would paint them an opaque white
              strip, so their box declares the light scheme. The extra space
              above separates PayPal's controls from the house's. */}
          <div ref={buttonsRef} className="mt-4 min-h-28 [color-scheme:light]">
            <p className="py-2 text-center text-xs text-carbon-textMuted">{text.loading}</p>
          </div>

          {status === "done" && <p className="text-sm text-statusOk">{text.thanks}</p>}
          {status === "failed" && <p className="text-sm text-statusFail">{text.failed}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button label={text.closeLabel} labelKey="common.close" tone="neutral" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
