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

/** The mark on the chosen option of a list, `IconCheck` from the assortment. */
export function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0.3 0.549 13.399 13.399" fill="currentColor" className="shrink-0" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M4.381 12.219 L4.574 12.378 L4.793 12.497 L5.032 12.572 L5.155 12.592 L5.405 12.596 L5.651 12.552 L5.884 12.461 L6.096 12.328 L6.278 12.157 L13.457 3.957 L13.584 3.736 L13.666 3.495 L13.699 3.242 L13.683 2.988 L13.656 2.863 L13.566 2.625 L13.431 2.408 L13.257 2.222 L13.05 2.074 L12.936 2.016 L12.695 1.934 L12.442 1.901 L12.188 1.917 L11.942 1.983 L11.713 2.096 L11.511 2.251 L5.238 9.399 L2.519 6.681 L2.425 6.595 L2.213 6.454 L1.977 6.356 L1.854 6.325 L1.6 6.3 L1.346 6.325 L1.223 6.356 L0.987 6.454 L0.775 6.595 L0.595 6.775 L0.454 6.987 L0.399 7.103 L0.325 7.346 L0.3 7.6 L0.306 7.727 L0.356 7.977 L0.399 8.097 L0.519 8.322 L0.681 8.519Z"
      />
    </svg>
  );
}

/** The mark on a closed list's trigger, `IconExpand` from the assortment. It turns over while the list is open. */
export function IconExpand() {
  return (
    <svg width="14" height="14" viewBox="3.6 2.95 12.8 12.8" fill="currentColor" className="shrink-0" aria-hidden="true">
      <path d="M10 13.4 3.6 7l1.7-1.7L10 10l4.7-4.7L16.4 7 10 13.4Z" />
    </svg>
  );
}

/** Minimise a window, `IconWindowMinimise` from the assortment: the bar the window goes down to. */
export function IconWindowMinimise() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor" className="shrink-0" aria-hidden="true">
      <rect x="0" y="6" width="14" height="2" rx="1" />
    </svg>
  );
}

/** Maximise a window, `IconWindowMaximise` from the assortment: the window filling the screen. */
export function IconWindowMaximise() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor" className="shrink-0" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.5 0h9A2.5 2.5 0 0 1 14 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 0 11.5v-9A2.5 2.5 0 0 1 2.5 0Zm0 2a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5Z"
      />
    </svg>
  );
}

/**
 * Restore a maximised window, `IconWindowRestore` from the assortment: the
 * window in front of the screen it filled. Not `IconRestore`, which brings a
 * backup back.
 */
export function IconWindowRestore() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor" className="shrink-0" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.5 3h6A2.5 2.5 0 0 1 11 5.5v6A2.5 2.5 0 0 1 8.5 14h-6A2.5 2.5 0 0 1 0 11.5v-6A2.5 2.5 0 0 1 2.5 3Zm0 2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-6a.5.5 0 0 0-.5-.5Z"
      />
      <path d="M5 0h6.5A2.5 2.5 0 0 1 14 2.5V9h-2V2.5a.5.5 0 0 0-.5-.5H5Z" />
    </svg>
  );
}
