import type { ReactNode } from "react";

// The icon on a "Save" button or a nav item is the app's vocabulary, so GlimStone
// ships the assortment as a specification (`reference/glyphs.md`) and lets the app
// register a resolver. `Button` then picks a glyph by meaning. Without a resolver a
// button falls back to the glyph it was handed, and with neither, to text alone.

let resolver: ((labelKey: string) => ReactNode | undefined) | null = null;

/**
 * Register the app's label-key-to-glyph mapping, once, at boot. A button that is
 * given no glyph cannot be shown in glyph mode, and one place to ask saves
 * passing an icon at every call site.
 */
export function setGlyphResolver(fn: (labelKey: string) => ReactNode | undefined): void {
  resolver = fn;
}

/** The mark for a label key, or nothing when no app resolver knows it. */
export function glyphFor(labelKey: string): ReactNode | undefined {
  return resolver ? resolver(labelKey) : undefined;
}

/**
 * The close mark: a plus rotated by 45 degrees, drawn as two rounded bars to
 * match the filled shapes of the assortment. The `2 2 10 10` viewBox is the box
 * every glyph in the set uses, so it carries the same optical weight as the
 * app's own icons.
 */
export function IconClose() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="2 2 10 10"
      fill="currentColor"
      className="shrink-0"
      aria-hidden="true"
    >
      <g transform="rotate(45 7 7)">
        <rect x="2" y="5.9" width="10" height="2.2" rx="1.1" />
        <rect x="5.9" y="2" width="2.2" height="10" rx="1.1" />
      </g>
    </svg>
  );
}

/**
 * The cancel mark. It draws the same shape as `IconClose`, but dismissing a
 * surface and abandoning an action mean different things at the call site, and
 * an app may want to draw them apart.
 */
export function IconCancel() {
  return <IconClose />;
}
