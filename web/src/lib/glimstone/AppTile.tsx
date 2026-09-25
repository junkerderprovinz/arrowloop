import type { MouseEvent, ReactNode } from "react";
import { InfoBubble } from "./InfoBubble";

// One way to get an app, on the App tab ("The App tab" in design-language.md):
// a mark above a name, hovering to the picker tile's grey. A link where it
// leads to a file or a listing, a button where it does something on the page,
// and a quiet tile with a badge where the listing does not exist yet: a tile
// that neither links nor acts is one that is still to come. `face` replaces
// the mark and the name, as the APK tile does with its code to scan.

export interface AppTileProps {
  name: string;
  logo: ReactNode;
  href?: string;
  onClick?: () => void;
  /** Runs on a click on the tile's link, for an app whose webview has no
   *  browser behind it to open the address in. */
  onLinkClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** The "(i)" in the tile's corner, for what the name cannot say. */
  hint?: string;
  face?: ReactNode;
  /** The badge on a tile with neither `href` nor `onClick`, "Soon". */
  soonLabel: string;
}

const tile =
  "flex h-28 w-28 flex-col items-center justify-center gap-2 rounded-control bg-carbon-surface2 text-carbon-text no-underline";
const live =
  "transition-colors duration-150 group-hover:bg-(--carbon-tile-hover) group-hover:text-(--carbon-tile-hover-ink)";

export function AppTile({ name, logo, href, onClick, onLinkClick, hint, face, soonLabel }: AppTileProps) {
  const body = face ?? (
    <>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center">{logo}</span>
      <span className="px-1 text-center text-xs font-medium leading-tight">{name}</span>
    </>
  );
  const soon = !href && !onClick;
  return (
    <div className="group relative">
      {soon ? (
        <div className={`${tile} text-carbon-textMuted`} aria-disabled>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center opacity-45">{logo}</span>
          <span className="px-1 text-center text-xs font-medium leading-tight">{name}</span>
        </div>
      ) : href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={onLinkClick}
          aria-label={name}
          className={`${tile} ${live}`}
        >
          {body}
        </a>
      ) : (
        <button type="button" onClick={onClick} aria-label={name} className={`${tile} ${live}`}>
          {body}
        </button>
      )}
      {soon && (
        <span className="absolute end-1.5 top-1.5 rounded-pill bg-carbon-surface3 px-1.5 py-0.5 text-[10px] font-semibold text-carbon-textSub">
          {soonLabel}
        </span>
      )}
      {hint && (
        <span className="absolute end-1.5 top-1.5 text-carbon-textSub group-hover:text-(--carbon-tile-hover-ink)">
          <InfoBubble tip={hint} />
        </span>
      )}
    </div>
  );
}

/** A vendor mark kept as its own markup, from appMarks.ts. */
export function BrandMark({ svg, className = "" }: { svg: string; className?: string }) {
  return (
    <span
      className={`block h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
