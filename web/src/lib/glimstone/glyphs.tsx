import type { ReactNode } from "react";

/**
 * The two marks the components in this folder draw for themselves, and the seam
 * through which an app hands them the rest.
 *
 * Everything else in an interface — the icon on a "Save" button, the one on a
 * nav item — is the APP's vocabulary, not the language's: only the app knows
 * that its own action is called "backup now" and that a shield is the right
 * mark for it. So GlimStone ships no icon set here. It ships the assortment as
 * a specification (`reference/glyphs.md`), and one function through which an app
 * registers its own resolver, so `Button` can keep picking a glyph BY MEANING
 * rather than by having one passed at every call site.
 *
 * An app that never calls `setGlyphResolver` loses nothing: a button without a
 * registered glyph simply falls back to the glyph it was handed directly, and
 * with neither, to text alone.
 */

/** Resolves a label key to the app's own mark. Unset until an app registers one. */
let resolver: ((labelKey: string) => ReactNode | undefined) | null = null;

/**
 * Register the app's label-key-to-glyph mapping, once, at boot.
 *
 * The mapping itself belongs to the app: it names the app's own actions. What
 * belongs here is only the fact that there IS one place to ask, so a control
 * never has to be told its own icon at every call site — that is the drift the
 * label engine exists to prevent, since a button that is given no glyph cannot
 * be shown in glyph mode at all.
 */
export function setGlyphResolver(fn: (labelKey: string) => ReactNode | undefined): void {
  resolver = fn;
}

/** The mark for a label key, or nothing when no app resolver knows it. */
export function glyphFor(labelKey: string): ReactNode | undefined {
  return resolver ? resolver(labelKey) : undefined;
}

/**
 * The close mark: a plus rotated by 45 degrees, drawn as two rounded bars.
 *
 * Two rounded rectangles rather than a stroked path, because the assortment is
 * filled shapes throughout and a two-stroke mark reads as borrowed from another
 * design system at exactly this size. The `2 2 10 10` viewBox is the normalised
 * box every glyph in the set uses, so this mark carries the same optical weight
 * as an app's own icons beside it.
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
 * The cancel mark, which is the same drawing as `IconClose`.
 *
 * Kept as its own export rather than an alias because the two mean different
 * things to a reader of the call site — dismissing a surface against abandoning
 * an action — and an app may well want to draw them apart later. They are one
 * shape today, and that is a decision, not an oversight: both say "this does not
 * happen", and giving them separate marks would ask the user to learn a
 * distinction the interface does not otherwise make.
 */
export function IconCancel() {
  return <IconClose />;
}
