/**
 * Which mark a button wears, decided once - as NAMES rather than as elements.
 *
 * Split out of `glyphFor.tsx` for the same reason the translation table and the
 * schedule reader were split out of theirs: the phone needs the decision and
 * cannot have the elements. That file returns React `<svg>`, which Metro cannot
 * parse; this one returns the name of a drawing, and each surface renders it
 * with whatever it has - `<svg>` in a browser, react-native-svg on a phone.
 *
 * ONE table, so a button cannot wear a tick in one place and a magnifier in the
 * other.
 */

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

type Rule = [RegExp, string]


const RULES: Rule[] = [
  // The About card's three, first and by exact key. They are the reason this
  // file exists, and each is a specific destination rather than a verb, so
  // nothing further down should be allowed to claim them.
  [/^about\.coffee/i, 'IconCoffee'],
  // The second way to give. A neutral wallet, and it never actually renders:
  // the call site hands over Bitcoin's own mark, which is what jdp asked for
  // and what GlimStone 1.8.3 settled on after arguing the opposite in 1.8.2.
  // The rule stays so the guard over unreachable label keys has something to
  // resolve, and so an app that passes no brand still gets a symbol rather
  // than a word among symbols.
  [/^about\.crypto$/i, 'IconWallet'],
  [/^about\.repo$/i, 'IconLink'],
  // The same generic link, and deliberately the same one: a hosted payment
  // page and a repository are both "opens somebody else's page", and
  // neither of these two rules ever actually renders. Both call sites hand
  // over that company's own mark, which is the house rule for a BRAND. The
  // rules exist so the guard over unreachable label keys stays absolute:
  // every key resolves something, with no allow-list to rot.
  [/^about\.paypal$/i, 'IconLink'],
  [/^about\.mail$/i, 'IconMail'],

  // Going back, and it has to sit ABOVE the preview rule rather than beside it:
  // the key that needs this is `preview.back`, which contains the word the rule
  // below matches on, so ordered the other way round the button leaving the
  // preview would wear the preview's own symbol. The same left-pointing arrow
  // the folder picker climbs with, because it is the same movement.
  [/\.back$|goBack|\.return$/i, 'IconUp'],

  // This app's own verbs, above anything generic. A preview is what this
  // program is FOR - reading a plan before anything moves - so it takes the eye
  // before "check" or "show" can.
  [/preview|dryRun/i, 'IconPreview'],
  [/runNow|\.run$|start|resume/i, 'IconRun'],
  [/pause|hold/i, 'IconPause'],

  // Destructive and corrective.
  [/\.(delete|remove|prune)$|removeJob|deleteDrive|discard/i, 'IconDelete'],
  [/forget/i, 'IconForget'],
  [/restore|revert|undo|reset/i, 'IconReset'],

  // Creation and editing.
  [/newFolder|addSet|createFolder/i, 'IconNewFolder'],
  // Opening a folder in the picker. Above the `\.add` rule so that a future
  // "open and add" key cannot be claimed by the wrong half.
  [/\.open$|openFolder/i, 'IconFolder'],
  // `register` belongs with `add` rather than on its own: registering a drive
  // IS adding one to the list, and the sibling control right beside it says
  // "add" and wears this mark. Without the word here, `targets.registerDrive`
  // matched nothing at all and fell back to its text, so in the mode meant to
  // show only symbols one button in that pair printed a word and the other did
  // not. jdp: "der datentraeger anmelden button ist nicht in der
  // beschriftungsengine."
  [/\.add|addStorage|addTarget|create|register/i, 'IconAdd'],
  // `copied` is spelled out beside `copy` rather than being caught by it: the
  // key is `targets.copied`, and `\.copy` does not match `.copied` because the
  // fourth letter is an i. Same button, same mark, only the word changes - and
  // without this line it changed from a symbol to a word in the mode that
  // exists to show no words.
  // `dupes` belongs here and not with the checks. What the duplicate search
  // finds IS copies, and two identical shapes say that at a glance - which
  // matters more than usual because its button sits in the same card as the
  // consistency check, and in glyph mode two inspections wearing the same
  // tick would be one control with two meanings.
  [/duplicate|dupes|copyPath|\.copy|copied/i, 'IconCopy'],

  // Carrying a whole setup out to a file and back in. ABOVE `save`, because
  // exporting is a save in the grammatical sense and a different act entirely:
  // one writes the file the program already owns, the other hands a copy to
  // somebody's own disk. One box with the arrow reversed says the pair without
  // a second silhouette to keep in step.
  [/export|download/i, 'IconDownload'],
  [/import|upload/i, 'IconUpload'],

  // ABOVE `edit`, and that ordering is a fix rather than a preference. A key
  // carries a NAMESPACE and a VERB, and the verb is what the button does:
  // `edit.save` is the save button on the job editor, and with `edit` first it
  // matched on its namespace and wore a PENCIL. Measured on the phone, next to
  // a target form whose `targets.save` wore the floppy correctly - the same
  // action with two marks, which is the collision the whole table exists to
  // prevent. The three keys this reorders are `edit.save`, `edit.savedNote`
  // and `edit.unsaved`, and saving is the right meaning for all three.
  // Dialogs, and this one is above `save` for the same reason `save` is above
  // `edit`: `confirm.cancel` is the way OUT of a confirmation dialog, and with
  // `confirm` matching first it wore the FLOPPY - a cancel button offering to
  // save, next to a confirm button offering the same thing. Found by the guard
  // in glyphName.verbs.test.ts on its first run, which is one more than the
  // number of times anybody had noticed it on screen.
  [/cancel|close|logout|dismiss/i, 'IconCancel'],

  [/save|apply|choose|submit|confirm/i, 'IconSave'],

  [/edit|rename/i, 'IconEdit'],
  [/\.up$|parent|levelUp/i, 'IconUp'],

  // Probing and inspection, below the app's own verbs so `preview` keeps the
  // eye and a consistency check gets the magnifier.
  [/check|verify|test|probe/i, 'IconCheck'],
  [/activity|history|log\b/i, 'IconHistory'],

  // Vaguest last.
  [/settings|config|engine|backup/i, 'IconSettings'],
]

/**
 * The name of the glyph for a translation key, or undefined when nothing
 * sensible matches.
 *
 * Undefined is a real answer rather than a gap to fill with a placeholder: a
 * button with no glyph keeps showing its text even in glyph mode, which beats a
 * symbol that means nothing.
 */
export function glyphNameFor(key: string): string | undefined {
  for (const [pattern, name] of RULES) {
    if (pattern.test(key)) return name
  }
  return undefined
}
