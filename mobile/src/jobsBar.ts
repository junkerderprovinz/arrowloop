import type { TranslationKey } from "./i18n";
import type { LabelMode } from "./settings";

export interface BarButton {
  id: "automatic" | "runAll" | "stopAll" | "add";
  /** The short word the button shows. */
  label: TranslationKey;
  /** The whole sentence a screen reader says. */
  spoken: TranslationKey;
  glyph: string;
  tone: "accent" | "neutral";
  disabled?: boolean;
}

/**
 * Returns the buttons at the foot of the job list, the job to add on the
 * right under the thumb. Stop all takes Run all's place while anything runs,
 * as on the web's overview.
 */
export function jobsBar({
  ready,
  running,
  paused,
  settingsLoaded,
}: {
  ready: number;
  running: number;
  paused: boolean;
  settingsLoaded: boolean;
}): BarButton[] {
  return [
    paused
      ? {
          id: "automatic",
          label: "phone.autoOn",
          spoken: "automatic.resume",
          // Run all beside it already wears the play mark.
          glyph: "IconSchedules",
          tone: "neutral",
          disabled: !settingsLoaded,
        }
      : {
          id: "automatic",
          label: "phone.autoOff",
          spoken: "automatic.pause",
          glyph: "IconPause",
          tone: "neutral",
          disabled: !settingsLoaded,
        },
    running > 0
      ? { id: "stopAll", label: "phone.stop", spoken: "phone.stopAll", glyph: "IconStop", tone: "neutral" }
      : {
          id: "runAll",
          label: "phone.runAll",
          spoken: "phone.runAll",
          glyph: "IconPlay",
          tone: "neutral",
          disabled: ready === 0,
        },
    { id: "add", label: "phone.add", spoken: "edit.add", glyph: "IconAdd", tone: "accent" },
  ];
}

/**
 * Decides how a row of equal buttons shows its labels: glyphs beside the
 * words, the words alone, or the glyphs alone once a word outgrows its share,
 * which GlimStone's selectors do too. `words` are the measured one-line
 * widths, undefined until measured.
 */
export function barFit(
  mode: LabelMode,
  words: (number | undefined)[],
  { room, gap, pad, glyph }: { room: number; gap: number; pad: number; glyph: number },
): "full" | "words" | "glyphs" {
  if (mode === "glyph" || mode === "reactive" || room <= 0) return "glyphs";
  if (words.some((w) => w === undefined)) return "glyphs";
  const share = (room - gap * (words.length - 1)) / words.length;
  const fits = (extra: number) => words.every((w) => (w ?? 0) + 2 * pad + extra <= share);
  if (mode === "textGlyph" && fits(glyph + gap)) return "full";
  return fits(0) ? "words" : "glyphs";
}
