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
import type { GiveFrequency } from "../paypal.ts";
import { Badge } from "./Badge.tsx";
import { Button } from "./Button.tsx";

export interface PaypalSelectorProps {
  labelledBy: string;
  options: { value: string; label: string }[];
  /** Null when no segment is picked, as while a typed amount applies. */
  value: string | null;
  onChange: (value: string) => void;
}

export interface PaypalDialogProps {
  text: {
    title: string;
    /** The app's appeal, the same in every giving window. */
    appeal: string;
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
  renderSelector: (props: PaypalSelectorProps) => ReactNode;
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
      className="glim-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-glim="PaypalDialog"
        data-glim-title={text.title}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paypal-window-title"
        className="glim-modal-card glim-modal-card--wide"
      >
        <div className="glim-modal-head">
          <h2 id="paypal-window-title" className="glim-modal-title">
            <Badge tone="heading" size="heading" wrap>
              {text.title}
            </Badge>
          </h2>
        </div>

        <div className="glim-give-body glim-give-body--scroll">
          <p className="glim-give-appeal">{text.appeal}</p>
          <p className="glim-give-intro">{text.intro}</p>

          <div className="glim-give-group">
            <span id="paypal-frequency" className="glim-eyebrow">
              {text.frequencyLabel}
            </span>
            {renderSelector({
              labelledBy: "paypal-frequency",
              options: frequencies.map((f) => ({ value: f, label: text.frequencies[f] })),
              value: frequency,
              onChange: (v) => onFrequency(v as GiveFrequency),
            })}
          </div>

          <div className="glim-give-group">
            <span id="paypal-amount" className="glim-eyebrow">
              {text.amountLabel}
            </span>
            {/* The presets keep the window's width, and the free amount stands
                at the end of the row under them. A valid entry takes the
                selection away from the presets. */}
            <div className="glim-give-amounts">
              <div>
                {renderSelector({
                  labelledBy: "paypal-amount",
                  options: amounts.map((a) => ({ value: a, label: `${a} ${currencySymbol}` })),
                  value: preset,
                  onChange: onPreset,
                })}
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={typed}
                placeholder={text.otherAmount}
                aria-label={text.otherAmount}
                aria-invalid={typed !== "" && !typedValid}
                onChange={(e) => onTyped(e.target.value)}
                className={`glim-give-amount${
                  typedValid ? " glim-give-amount--valid" : ""
                }`}
              />
            </div>
          </div>

          <div ref={buttonsRef} className="glim-give-wallet">
            <p className="glim-give-loading">{text.loading}</p>
          </div>

          {status === "done" && <p className="glim-give-status glim-give-status--ok">{text.thanks}</p>}
          {status === "failed" && <p className="glim-give-status glim-give-status--fail">{text.failed}</p>}
        </div>

        <div className="glim-give-foot">
          <Button label={text.closeLabel} labelKey="common.close" tone="neutral" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
