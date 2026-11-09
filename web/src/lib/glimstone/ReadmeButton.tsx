import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { keepReadmeFit, readmePartClass, readmeSoon, readmeUnitClass, type ReadmeBrand, type ReadmePart } from "../readmeButton.ts";
import { InfoBubble } from "./InfoBubble.tsx";

// A button in the shape of the README's download buttons, on the App tab and
// the About card ("The App tab" in design-language.md). The first part carries
// the mark and the full name; the parts after it are segments that name only
// what differs, such as ARM beside Windows. The unit lights up as one in its
// brand's colour ("Brand tiles"). A link where a part leads to a file or a
// listing, a button where it does something on the page, and a quiet unit with
// "Soon" as its second line where the listing does not exist yet.

export type { ReadmeBrand, ReadmePart } from "../readmeButton.ts";

export interface ReadmeButtonProps {
  /** The brand whose colour the unit lights up in. */
  brand: ReadmeBrand;
  /** The button, then its segments. */
  parts: [ReadmePart, ...ReadmePart[]];
  mark?: ReactNode;
  /** The class that paints the mark at rest, such as `glim-windows-mark`. It
   *  sits on the mark's box, where the lit unit's ink can override it. */
  markClass?: string;
  /** A vendor's own button artwork, which replaces the first part's mark and words. */
  art?: ReactNode;
  /** The "(i)" at the end of the unit, for what the name cannot say. */
  hint?: string;
  /** Holds the second lines in view while one reports what it did, such as "Copied". */
  note?: boolean;
  /** The second line of a unit whose first part has neither `href` nor `onClick`. */
  soonLabel?: string;
  /** Runs on a click on a part's link, for an app whose webview has no browser
   *  behind it to open the address in. */
  onLinkClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

export function ReadmeButton({ brand, parts, mark, markClass, art, hint, note, soonLabel, onLinkClick }: ReadmeButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const soon = readmeSoon(parts);
  const words = parts.map((p) => `${p.name}\n${p.sub ?? ""}`).join("\n") + (soon ? soonLabel : "");
  useLayoutEffect(() => (ref.current ? keepReadmeFit(ref.current) : undefined), [words]);

  return (
    <div ref={ref} className={readmeUnitClass(brand, parts.length, !!note, soon)}>
      {parts.map((part, i) => {
        const sub = soon ? soonLabel : part.sub;
        const label = part.label ?? (sub ? `${part.name} ${sub}` : part.name);
        const className = readmePartClass(i, soon);
        const face =
          i === 0 && art ? (
            <span className="glim-readme-btn-art" aria-hidden>
              {art}
            </span>
          ) : (
            <>
              {i === 0 && mark && (
                <span className={`glim-readme-btn-mark ${markClass ?? ""}`} aria-hidden>
                  {mark}
                </span>
              )}
              <span className="glim-readme-btn-text">
                <span className="glim-readme-btn-name">{part.name}</span>
                {sub && <span className="glim-readme-btn-sub">{sub}</span>}
              </span>
            </>
          );
        if (soon) {
          return (
            <span key={i} className={className} aria-disabled aria-label={label}>
              {face}
            </span>
          );
        }
        if (part.href) {
          return (
            <a
              key={i}
              href={part.href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={onLinkClick}
              aria-label={label}
              className={className}
            >
              {face}
            </a>
          );
        }
        return (
          <button key={i} type="button" onClick={part.onClick} aria-label={label} className={className}>
            {face}
          </button>
        );
      })}
      {!soon && <span className="glim-readme-btn-sheen" aria-hidden />}
      {hint && (
        <span className="glim-readme-btn-hint">
          <InfoBubble tip={hint} />
        </span>
      )}
    </div>
  );
}

/** A vendor mark kept as its own markup, from appMarks.ts. */
export function BrandMark({ svg }: { svg: string }) {
  return <span className="glim-brand-svg" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
