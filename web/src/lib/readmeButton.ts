// The button in the shape of the README's: a unit of one or more parts that
// lights up in its brand's colour. The look is `.glim-readme-btn-*` in
// tokens.css; the marks are in appMarks.ts.

export const README_TILES = {
  windows: "glim-tile-windows",
  apple: "glim-tile-apple",
  linux: "glim-tile-linux",
  flatpak: "glim-tile-flatpak",
  android: "glim-tile-android",
  play: "glim-tile-play",
  fdroid: "glim-tile-fdroid",
  docker: "glim-tile-docker",
  unraid: "glim-tile-unraid",
  mos: "glim-tile-mos",
  zimaos: "glim-tile-zimaos",
  umbrel: "glim-tile-umbrel",
  zip: "glim-tile-zip",
  github: "glim-tile-github",
  paypal: "glim-tile-paypal",
  bitcoin: "glim-tile-bitcoin",
  coffee: "glim-tile-coffee",
  house: "glim-tile-house",
  docs: "glim-tile-docs",
} as const;

export type ReadmeBrand = keyof typeof README_TILES;

export interface ReadmePart {
  name: string;
  /** The second line, shown under the pointer. Without one the name stays in the middle. */
  sub?: string;
  /** The accessible name of a segment whose word reads right only beside the
   *  first part, such as "Windows ARM" for ARM. */
  label?: string;
  href?: string;
  onClick?: () => void;
}

/** A unit whose first part goes nowhere is still to come. */
export function readmeSoon(parts: ReadmePart[]): boolean {
  return !parts[0]?.href && !parts[0]?.onClick;
}

/** The part's accessible name, with `sub` the second line it shows. */
export function readmePartLabel(part: ReadmePart, sub: string | undefined): string {
  return part.label ?? (sub ? `${part.name} ${sub}` : part.name);
}

export function readmeUnitClass(brand: ReadmeBrand, parts: number, note: boolean, soon: boolean): string {
  return [
    "glim-readme-btn-unit",
    "group",
    README_TILES[brand],
    parts > 1 && "glim-readme-btn-group",
    note && "glim-readme-btn-unit--note",
    soon && "glim-readme-btn-soon",
  ]
    .filter(Boolean)
    .join(" ");
}

export function readmePartClass(index: number, soon: boolean): string {
  return `glim-readme-btn${index > 0 ? " glim-readme-btn-seg" : ""}${soon ? "" : " glim-brand-tile"}`;
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

/** Fits the unit's words now, on every resize and once the fonts are in. Returns the cleanup. */
export function keepReadmeFit(root: HTMLElement): () => void {
  const fit = () => fitReadmeText(root);
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(root);
  void document.fonts?.ready.then(fit);
  return () => observer.disconnect();
}
