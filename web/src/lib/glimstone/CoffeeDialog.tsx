// The window for Buy Me a Coffee: the maker's own BMAC widget inside a house
// window, so a donor pays without leaving the app.
//
// The widget page is the one BMAC page that allows framing; the profile page
// answers X-Frame-Options: SAMEORIGIN. It keeps BMAC's look and every feature
// BMAC offers there, card and wallet payments included. Mount the window only
// while it is open, so nothing from BMAC loads before somebody asks for it.
import type { Ref } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";

export interface CoffeeDialogProps {
  /** `https://buymeacoffee.com/widget/page/<handle>` with its query. */
  widgetUrl: string;
  text: {
    title: string;
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
      className="glim-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
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
        className="glim-modal-card relative flex h-[calc(100vh-7rem)] w-full max-w-lg flex-col rounded-card bg-carbon-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <h2 id="coffee-title" className="flex items-center">
            <Badge tone="heading" size="heading" wrap>
              {text.title}
            </Badge>
          </h2>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-5">
          <p className="text-sm text-carbon-textSub">{text.intro}</p>
          <div className="flex min-h-0 flex-1 rounded-card bg-carbon-surface2 p-2">
            {/* White behind the frame so the first paint is not a dark hole
                on the dark theme; BMAC's page is light either way. */}
            <iframe
              src={widgetUrl}
              title={text.title}
              allow="payment"
              className="min-h-0 w-full flex-1 rounded-control border-0 bg-white"
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
