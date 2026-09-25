// Which mark a button wears, as the name of a drawing rather than an element,
// so the browser and the phone share one table. It maps by meaning off the
// translation key, which is the same in every language.
//
// The first match wins, so specific patterns sit above general ones. A key
// that matches nothing returns undefined and the button keeps its text.

type Rule = [RegExp, string]

const RULES: Rule[] = [
  // The About card's destinations, by exact key so no verb below claims them.
  [/^about\.coffee/i, 'IconCoffee'],
  // The call sites pass a brand mark for crypto, PayPal and the repository.
  // These rules still resolve so every label key has a glyph and an app that
  // passes no brand gets a symbol.
  [/^about\.crypto$/i, 'IconWallet'],
  [/^about\.repo$/i, 'IconLink'],
  [/^about\.paypal$/i, 'IconLink'],
  [/^about\.mail$/i, 'IconMail'],

  // Above the preview rule, which would otherwise claim `preview.back`.
  [/\.back$|goBack|\.return$/i, 'IconUp'],

  // This app's own verbs, above anything generic.
  [/preview|dryRun/i, 'IconPreview'],
  // Syncing is the circle the jobs tab wears, and sits above the run rule
  // because `syncNow` contains its word.
  [/^overview\.syncNow$/i, 'IconJobs'],
  [/runNow|\.run$|start|resume/i, 'IconRun'],
  // Cancelling a run throws its work away, which is not the same as pausing.
  [/cancelRun|abort/i, 'IconCancel'],

  // Above the generic rules, which gave `phone.engineStop` the settings gear.
  [/pause|hold|stop/i, 'IconPause'],

  // Destructive and corrective.
  [/\.(delete|remove|prune)$|removeJob|deleteDrive|discard/i, 'IconDelete'],
  [/forget/i, 'IconForget'],
  [/restore|revert|undo|reset/i, 'IconReset'],

  // Creation and editing.
  [/newFolder|addSet|createFolder/i, 'IconNewFolder'],
  // Above `\.add`, so an "open and add" key cannot be claimed by the wrong half.
  [/\.open$|openFolder/i, 'IconFolder'],
  // Registering a drive adds it to the list, like the control beside it.
  [/\.add|addStorage|addTarget|create|register/i, 'IconAdd'],
  // `\.copy` does not match `targets.copied`, so it is spelled out. The
  // duplicate search finds copies, and sharing the check's tick would give two
  // controls in one card the same mark.
  [/duplicate|dupes|copyPath|\.copy|copied/i, 'IconCopy'],

  // Above `save`: exporting hands a copy to the person's disk rather than
  // writing the program's own file.
  [/^apps\.qr$/i, 'IconQr'],
  [/^apps\.download$/i, 'IconArrowDown'],
  [/export|download/i, 'IconDownload'],
  [/^history\.filter$/i, 'IconFilter'],
  [/import|upload/i, 'IconUpload'],

  // A key is namespace and verb, and the verb decides. Cancel sits above save
  // so `confirm.cancel` does not wear the floppy, and save above edit so
  // `edit.save` does not wear the pencil.
  [/cancel|close|logout|dismiss/i, 'IconCancel'],

  [/save|apply|choose|submit|confirm/i, 'IconSave'],

  [/edit|rename/i, 'IconEdit'],
  [/\.up$|parent|levelUp/i, 'IconUp'],

  // Below the app's own verbs, so `preview` keeps the eye.
  [/check|verify|test|probe/i, 'IconCheck'],
  [/activity|history|log\b/i, 'IconHistory'],

  // Above the settings rule, since the lock's keys live under `settings.`.
  [/lock/i, 'IconLock'],

  // Vaguest last.
  [/settings|config|engine|backup/i, 'IconSettings'],
]

/**
 * The name of the glyph for a translation key, or undefined when nothing
 * matches, in which case the button shows its text even in glyph mode.
 */
export function glyphNameFor(key: string): string | undefined {
  for (const [pattern, name] of RULES) {
    if (pattern.test(key)) return name
  }
  return undefined
}
