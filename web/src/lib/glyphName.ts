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

  // A stored secret's two buttons, and the way from a settings tile to its page.
  [/^notify\.change$/i, 'IconPencil'],
  [/^notify\.keep$/i, 'IconClose'],
  [/^settings\.open$/i, 'IconLink'],

  // Above the preview rule, which would otherwise claim `preview.back`.
  [/\.back$|goBack|\.return$/i, 'IconBack'],

  // This app's own verbs, above anything generic.
  [/preview|dryRun/i, 'IconPreview'],
  // Syncing is the circle the jobs tab wears, and sits above the run rule
  // because `syncNow` contains its word.
  [/^tray\.syncNow$/i, 'IconSync'],
  [/runNow|\.run$|start|resume/i, 'IconPlay'],
  // Cancelling a run throws its work away, which is not the same as pausing.
  [/cancelRun|abort/i, 'IconClose'],

  // Above the generic rules, which gave `phone.engineStop` the settings gear.
  [/pause|hold|stop/i, 'IconPause'],

  // Destructive and corrective.
  [/\.(delete|remove|prune)$|\.empty(All|Side)$|removeJob|deleteDrive|discard/i, 'IconTrash'],
  [/forget/i, 'IconForget'],
  [/restore|revert|undo|reset/i, 'IconRefresh'],

  // Creation and editing.
  [/newFolder|addSet|createFolder/i, 'IconFolderAdd'],
  // The desktop app's main window, which is no folder.
  [/^tray\.open$/i, 'IconTabApp'],
  // Above `\.add`, so an "open and add" key cannot be claimed by the wrong half.
  [/\.open$|openFolder/i, 'IconFolder'],
  // Registering a drive adds it to the list, like the control beside it.
  [/\.add|addStorage|addTarget|create|register/i, 'IconAdd'],
  // `\.copy` does not match `targets.copied`, so it is spelled out. The
  // duplicate search finds copies, and sharing the check's tick would give two
  // controls in one card the same mark.
  [/duplicate|dupes|copyPath|\.copy|copied/i, 'IconCopy'],

  // Seen and closed, which is the tick and not the floppy `confirm` would give.
  [/acknowledge/i, 'IconCheck'],

  // Above `save`: exporting hands a copy to the person's disk rather than
  // writing the program's own file.
  [/^apps\.qr$/i, 'IconQr'],
  [/export|download/i, 'IconDownload'],
  [/^history\.filter$/i, 'IconFilter'],
  [/import|upload/i, 'IconUpload'],

  // A key is namespace and verb, and the verb decides. Cancel sits above save
  // so `confirm.cancel` does not wear the floppy, and save above edit so
  // `edit.save` does not wear the pencil.
  [/logout/i, 'IconSignOut'],
  [/cancel|close|dismiss/i, 'IconClose'],

  [/save|apply|choose|submit|confirm/i, 'IconSave'],

  [/edit|rename/i, 'IconPencil'],
  [/\.up$|parent|levelUp/i, 'IconFolderUp'],

  // Below the app's own verbs, so `preview` keeps the eye.
  [/check|verify|test|probe/i, 'IconCheck'],
  [/activity|history|log\b/i, 'IconHistory'],

  // Above the settings rule, since the lock's keys live under `settings.`.
  [/unlock/i, 'IconUnlock'],
  [/lock/i, 'IconLock'],

  // A button that opens a menu of further actions.
  [/\.options$/i, 'IconMore'],
  // Picks one of the shares the computer is connected to, as a folder.
  [/pickShare/i, 'IconFolder'],

  // Vaguest last.
  [/settings|config|engine|backup/i, 'IconGear'],
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
