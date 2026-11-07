import type { ReactNode } from "react";
import { MARKS, type Mark } from "../marks.ts";

// The icon on a "Save" button or a nav item is the app's vocabulary, so GlimStone
// ships the assortment as a specification (`packages/core/glyphs.md`) and lets the app
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

/** A mark from the core, drawn in the current colour. */
export function MarkSvg({ mark, className }: { mark: Mark; className?: string }) {
  return (
    <svg
      width={mark.size}
      height={mark.size}
      viewBox={mark.viewBox}
      fill="currentColor"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: mark.body }}
    />
  );
}

export const IconClose = () => <MarkSvg mark={MARKS.close} className="glim-mark" />;
export const IconCancel = () => <MarkSvg mark={MARKS.cancel} className="glim-mark" />;
export const IconCheck = () => <MarkSvg mark={MARKS.check} className="glim-mark" />;
export const IconExpand = () => <MarkSvg mark={MARKS.expand} className="glim-mark" />;
export const IconFolderOpen = () => <MarkSvg mark={MARKS.folderOpen} className="glim-mark" />;
export const IconPencil = () => <MarkSvg mark={MARKS.pencil} className="glim-mark" />;
export const IconWindowMinimise = () => <MarkSvg mark={MARKS.windowMinimise} className="glim-mark" />;
export const IconWindowMaximise = () => <MarkSvg mark={MARKS.windowMaximise} className="glim-mark" />;
export const IconWindowRestore = () => <MarkSvg mark={MARKS.windowRestore} className="glim-mark" />;
export const IconEye = () => <MarkSvg mark={MARKS.eye} className="glim-mark" />;
export const IconEyeOff = () => <MarkSvg mark={MARKS.eyeOff} className="glim-mark" />;
export const IconCopy = () => <MarkSvg mark={MARKS.copy} className="glim-mark" />;
