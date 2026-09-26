import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { InfoBubble } from "./InfoBubble";

// A button in the shape of the README's download buttons, on the App tab and
// the About card ("The App tab" in design-language.md). The first part carries
// the mark and the full name; the parts after it are segments that name only
// what differs, such as ARM64 beside Windows. The unit lights up as one in its
// brand's colour ("Brand tiles"). A link where a part leads to a file or a
// listing, a button where it does something on the page, and a quiet unit with
// "Soon" as its second line where the listing does not exist yet.

// The brands tokens.css carries a tile colour for, each with its class.
const TILES = {
  windows: "glim-tile-windows",
  apple: "glim-tile-apple",
  linux: "glim-tile-linux",
  android: "glim-tile-android",
  play: "glim-tile-play",
  docker: "glim-tile-docker",
  unraid: "glim-tile-unraid",
  zip: "glim-tile-zip",
  github: "glim-tile-github",
  paypal: "glim-tile-paypal",
  bitcoin: "glim-tile-bitcoin",
  coffee: "glim-tile-coffee",
  house: "glim-tile-house",
} as const;

export interface ReadmePart {
  name: string;
  /** The second line, shown under the pointer. Without one the name stays in the middle. */
  sub?: string;
  href?: string;
  onClick?: () => void;
}

export interface ReadmeButtonProps {
  /** The brand whose colour the unit lights up in. */
  brand: keyof typeof TILES;
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
  const soon = !parts[0].href && !parts[0].onClick;
  const words = parts.map((p) => `${p.name}\n${p.sub ?? ""}`).join("\n") + (soon ? soonLabel : "");
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fit = () => fitReadmeText(root);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [words]);

  const unit = ["glim-readme-btn-unit", "group", TILES[brand]];
  if (parts.length > 1) unit.push("glim-readme-btn-group");
  if (note) unit.push("glim-readme-btn-unit--note");
  if (soon) unit.push("glim-readme-btn-soon");

  return (
    <div ref={ref} className={unit.join(" ")}>
      {parts.map((part, i) => {
        const sub = soon ? soonLabel : part.sub;
        const label = sub ? `${part.name} ${sub}` : part.name;
        const className = `glim-readme-btn${i > 0 ? " glim-readme-btn-seg" : ""}${soon ? "" : " glim-brand-tile"}`;
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
        <span className="glim-readme-btn-hint text-carbon-textSub">
          <InfoBubble tip={hint} />
        </span>
      )}
    </div>
  );
}

/**
 * Shrinks a translation longer than its button instead of cutting it off. A
 * line in a hidden tab measures nothing, so the button fits it again when a
 * resize shows it.
 */
export function fitReadmeText(root: HTMLElement): void {
  for (const line of root.querySelectorAll<HTMLElement>(".glim-readme-btn-name, .glim-readme-btn-sub")) {
    line.style.fontSize = "";
    if (line.clientWidth === 0) continue;
    const over = line.scrollWidth / line.clientWidth;
    if (over > 1) line.style.fontSize = `${parseFloat(getComputedStyle(line).fontSize) / over}px`;
  }
}

/** A vendor mark kept as its own markup, from appMarks.ts. */
export function BrandMark({ svg }: { svg: string }) {
  return <span className="contents" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
