import type { ReactNode } from 'react'

import {
  IconAdd,
  IconCheck,
  IconCoffee,
  IconCopy,
  IconDelete,
  IconDownload,
  IconEdit,
  IconFolder,
  IconForget,
  IconHistory,
  IconLink,
  IconMail,
  IconNewFolder,
  IconPause,
  IconPreview,
  IconReset,
  IconRun,
  IconSave,
  IconSettings,
  IconUp,
  IconUpload,
} from '../components/glyphs'
import { IconCancel } from '../components/glyphs'

// ---------------------------------------------------------------------------
// glyphFor - which symbol a button wears, decided once.
//
// It was a `switch` over eight keys in main.tsx, and eight was the problem: the
// app has around forty buttons, so thirty-two of them resolved to nothing and
// fell back to their text. In glyph mode that is a strip where some controls are
// symbols and the rest are words, which reads as an unfinished setting rather
// than as a choice, and the only way to find the gaps was to go looking. The
// About card is how they were found: jdp saw three buttons with no marks on
// them ("in der uebercard fehlen die glyphen") on a card this app does not even
// draw itself.
//
// So it is a rule table now, ported from the sibling app rather than
// re-invented, and it maps by MEANING off the translation key. A key is stable
// across all forty-two languages in a way the visible text is not, and a reader
// learns "this shape means delete" far faster from one repeated symbol than from
// forty unique ones.
//
// ORDER MATTERS: the first match wins, so specific patterns sit above general
// ones. A key that matches nothing returns undefined, and Button then shows that
// button's text rather than an empty square, which is the one failure mode worth
// having.
// ---------------------------------------------------------------------------

type Rule = [RegExp, () => ReactNode]

const RULES: Rule[] = [
  // The About card's three, first and by exact key. They are the reason this
  // file exists, and each is a specific destination rather than a verb, so
  // nothing further down should be allowed to claim them.
  [/^about\.coffee/i, () => <IconCoffee />],
  [/^about\.repo$/i, () => <IconLink />],
  [/^about\.mail$/i, () => <IconMail />],

  // Going back, and it has to sit ABOVE the preview rule rather than beside it:
  // the key that needs this is `preview.back`, which contains the word the rule
  // below matches on, so ordered the other way round the button leaving the
  // preview would wear the preview's own symbol. The same left-pointing arrow
  // the folder picker climbs with, because it is the same movement.
  [/\.back$|goBack|\.return$/i, () => <IconUp />],

  // This app's own verbs, above anything generic. A preview is what this
  // program is FOR - reading a plan before anything moves - so it takes the eye
  // before "check" or "show" can.
  [/preview|dryRun/i, () => <IconPreview />],
  [/runNow|\.run$|start|resume/i, () => <IconRun />],
  [/pause|hold/i, () => <IconPause />],

  // Destructive and corrective.
  [/\.(delete|remove|prune)$|removeJob|discard/i, () => <IconDelete />],
  [/forget/i, () => <IconForget />],
  [/restore|revert|undo|reset/i, () => <IconReset />],

  // Creation and editing.
  [/newFolder|addSet|createFolder/i, () => <IconNewFolder />],
  // Opening a folder in the picker. Above the `\.add` rule so that a future
  // "open and add" key cannot be claimed by the wrong half.
  [/\.open$|openFolder/i, () => <IconFolder />],
  // `register` belongs with `add` rather than on its own: registering a drive
  // IS adding one to the list, and the sibling control right beside it says
  // "add" and wears this mark. Without the word here, `targets.registerDrive`
  // matched nothing at all and fell back to its text, so in the mode meant to
  // show only symbols one button in that pair printed a word and the other did
  // not. jdp: "der datentraeger anmelden button ist nicht in der
  // beschriftungsengine."
  [/\.add|addStorage|addTarget|create|register/i, () => <IconAdd />],
  // `copied` is spelled out beside `copy` rather than being caught by it: the
  // key is `targets.copied`, and `\.copy` does not match `.copied` because the
  // fourth letter is an i. Same button, same mark, only the word changes - and
  // without this line it changed from a symbol to a word in the mode that
  // exists to show no words.
  [/duplicate|copyPath|\.copy|copied/i, () => <IconCopy />],
  [/edit|rename/i, () => <IconEdit />],

  // Carrying a whole setup out to a file and back in. ABOVE `save`, because
  // exporting is a save in the grammatical sense and a different act entirely:
  // one writes the file the program already owns, the other hands a copy to
  // somebody's own disk. One box with the arrow reversed says the pair without
  // a second silhouette to keep in step.
  [/export|download/i, () => <IconDownload />],
  [/import|upload/i, () => <IconUpload />],

  [/save|apply|choose|submit|confirm/i, () => <IconSave />],

  // Dialogs.
  [/cancel|close|logout|dismiss/i, () => <IconCancel />],
  [/\.up$|parent|levelUp/i, () => <IconUp />],

  // Probing and inspection, below the app's own verbs so `preview` keeps the
  // eye and a consistency check gets the magnifier.
  [/check|verify|test|probe/i, () => <IconCheck />],
  [/activity|history|log\b/i, () => <IconHistory />],

  // Vaguest last.
  [/settings|config|engine|backup/i, () => <IconSettings />],
]

/**
 * The glyph for a translation key, or undefined when nothing sensible matches.
 *
 * Undefined is a real answer rather than a gap to fill with a placeholder: a
 * button with no glyph keeps showing its text even in glyph mode, which beats a
 * symbol that means nothing.
 */
export function glyphFor(key: string): ReactNode | undefined {
  for (const [pattern, make] of RULES) {
    if (pattern.test(key)) return make()
  }
  return undefined
}
