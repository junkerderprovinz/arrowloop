// The window for Buy Me a Coffee: the maker's own BMAC widget inside a house
// window, so a donor pays without leaving the app.
//
// The widget page is the one BMAC page that allows framing; the profile page
// answers X-Frame-Options: SAMEORIGIN. It keeps BMAC's look and every feature
// BMAC offers there, card and wallet payments included. Mount the window only
// while it is open, so nothing from BMAC loads before somebody asks for it.
import type { Ref } from "react";
import { Badge } from "./Badge.tsx";
import { Button } from "./Button.tsx";

export interface CoffeeDialogProps {
  /** `https://buymeacoffee.com/widget/page/<handle>` with its query. */
  widgetUrl: string;
  text: {
    title: string;
    /** The app's appeal, the same in every giving window. */
    appeal: string;
    /** One sentence: the payment happens at BMAC, and no account is needed. */
    intro: string;
    closeLabel: string;
  };
  onClose: () => void;
  /** The window's own card, for the app's Escape handling and focus trap. */
  ref?: Ref<HTMLDivElement>;
}

export function CoffeeDialog({ widgetUrl, text, onClose, ref }: CoffeeDialogProps) {
  return (
    <div
      className="glim-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* As tall as the screen allows less a margin: BMAC's payment step is
          about 1200px, and every pixel here is scrolling a donor is spared. */}
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coffee-title"
        className="glim-modal-card glim-modal-card--wide glim-modal-card--tall"
      >
        <div className="glim-modal-head">
          <h2 id="coffee-title" className="glim-modal-title">
            <Badge tone="heading" size="heading" wrap>
              {text.title}
            </Badge>
          </h2>
        </div>

        <div className="glim-give-body">
          <p className="glim-give-appeal">{text.appeal}</p>
          <p className="glim-give-intro">{text.intro}</p>
          <div className="glim-give-frame">
            <iframe
              src={widgetUrl}
              title={text.title}
              allow="payment"
              className="glim-give-iframe"
            />
          </div>
        </div>

        <div className="glim-give-foot">
          <Button label={text.closeLabel} labelKey="common.close" tone="neutral" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
