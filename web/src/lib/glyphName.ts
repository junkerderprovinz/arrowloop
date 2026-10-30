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
  [/^about\.releaseNotes$/i, 'IconInfo'],
  // The update check's answers. After a failure the same button tries again.
  [/^about\.upToDate$/i, 'IconUpToDate'],
  [/^about\.updatesFound$/i, 'IconUpdateAvailable'],
  [/^about\.checkFailed$/i, 'IconRetry'],

  // The way in. These sit above the reset rule, which would claim the
  // password reset's link and its last button.
  [/^login\.submit$/i, 'IconSignIn'],
  [/^reset\.link$/i, 'IconForgotPassword'],
  [/^reset\.done$|^twoFactor\.(confirm|recoverySaved)$/i, 'IconConfirm'],
  [/^password\.save(First|Change)$/i, 'IconKey'],
  [/^(password|passkey)\.remove$/i, 'IconKeyRevoke'],
  [/^twoFactor\.add$/i, 'IconShieldOn'],
  [/^twoFactor\.remove$/i, 'IconShieldOff'],
  [/^notify\.test$/i, 'IconSendTest'],

  // The three answers to a conflict, for one or for all of them.
  [/^conflicts?\.(answer|all|keep)Both$/i, 'IconKeepBoth'],
  [/^conflicts?\.(answer|all|keep)Left$/i, 'IconKeepLeft'],
  [/^conflicts?\.(answer|all|keep)Right$/i, 'IconKeepRight'],

  // A stored secret's two buttons, and the way from a settings tile to its page.
  [/^notify\.change$/i, 'IconPencil'],
  [/^notify\.keep$/i, 'IconClose'],
  [/^settings\.open$/i, 'IconLink'],
  // A setting taken from the defaults: giving it a value of its own, and back.
  [/^defaults\.override$/i, 'IconPencil'],
  [/^defaults\.useDefault$/i, 'IconRefresh'],

  // What is new: the releases on GitHub, following a change, and showing or
  // settling the lot. The releases button passes the GitHub mark itself.
  [/^new\.releases$/i, 'IconLink'],
  [/^new\.go$/i, 'IconLink'],
  [/^new\.showAll$/i, 'IconEye'],
  [/^new\.markAll$/i, 'IconCheck'],
  // A finding card opening and closing in place.
  [/^anomaly\.showMore$/i, 'IconEye'],
  [/^anomaly\.showLess$/i, 'IconEyeOff'],

  // A job's trash wears the trash page's own mark, not the pencil `edit.`
  // would give it. The duplicate search looks for something, so a menu that
  // also holds Duplicate does not show the copy mark twice.
  [/openTrash/i, 'IconTabRecovery'],
  [/^jobs\.dupes$/i, 'IconSearch'],

  // Above the preview rule, which would otherwise claim `preview.back`.
  [/\.back$|goBack|\.return$/i, 'IconBack'],

  // This app's own verbs, above anything generic.
  [/preview|dryRun/i, 'IconPreview'],
  // Syncing is the circle the jobs tab wears, and sits above the run rule
  // because `syncNow` contains its word.
  [/^tray\.syncNow$/i, 'IconSync'],
  [/runNow|runAll|\.run$|start|resume/i, 'IconPlay'],
  // Cancelling a run throws its work away, which is not the same as pausing.
  // Above the generic rules, which gave `phone.engineStop` the settings gear.
  [/cancelRun|stopAll|stopping|engineStop|abort/i, 'IconStop'],
  [/pause|hold/i, 'IconPause'],

  // Destructive and corrective. Emptying a trash clears a list, and restoring
  // the settings from the welcome page reads a backup in.
  [/\.empty(All|Side)$/i, 'IconEmpty'],
  [/\.prune$/i, 'IconPrune'],
  [/\.(delete|remove)$|removeJob|deleteDrive|discard/i, 'IconTrash'],
  [/forget/i, 'IconForget'],
  [/^welcome\.restore$/i, 'IconImport'],
  [/restore|revert/i, 'IconRestore'],
  [/undo/i, 'IconUndo'],
  [/reset/i, 'IconRefresh'],

  // Creation and editing.
  [/newFolder|addSet|createFolder/i, 'IconFolderAdd'],
  // The desktop app's main window, which is no folder.
  [/^tray\.open$/i, 'IconApp'],
  // Above `\.add`, so an "open and add" key cannot be claimed by the wrong half.
  [/\.open$|openFolder/i, 'IconFolder'],
  // Registering a drive adds it to the list, like the control beside it.
  [/\.add|addStorage|addTarget|create|register/i, 'IconAdd'],
  // `\.copy` does not match `targets.copied`, so it is spelled out. The
  // duplicate search finds copies, and sharing the check's tick would give two
  // controls in one card the same mark.
  [/duplicate|dupes|copyPath|\.copy|copied/i, 'IconCopy'],

  // Seen and closed, which is the tick and not the thumb `confirm` would give.
  [/acknowledge/i, 'IconCheck'],

  // Above `save`: exporting hands a copy to the person's disk rather than
  // writing the program's own file. A run's list is written out the same way.
  [/^apps\.qr$/i, 'IconQr'],
  [/export|^history\.download$/i, 'IconExport'],
  [/download/i, 'IconDownload'],
  [/^history\.filter$|^list\.filter$/i, 'IconFilter'],
  [/^list\.sort$/i, 'IconSort'],
  [/^list\.search$/i, 'IconSearch'],
  [/import/i, 'IconImport'],
  [/upload/i, 'IconUpload'],

  // A key is namespace and verb, and the verb decides. Cancel sits above the
  // confirmation so `confirm.cancel` does not wear the thumb, and save above
  // edit so `edit.save` does not wear the pencil.
  [/logout/i, 'IconSignOut'],
  // Showing every job again takes away the chip that narrowed the page.
  [/cancel|close|dismiss|everyJob/i, 'IconClose'],

  [/save|submit/i, 'IconSave'],
  [/apply|choose/i, 'IconApply'],
  [/confirm$|\.done$|gotIt/i, 'IconConfirm'],

  [/edit|rename/i, 'IconPencil'],
  [/\.up$|parent|levelUp/i, 'IconBack'],

  // Below the app's own verbs, so `preview` keeps the eye.
  [/check|verify|test|probe/i, 'IconCheck'],
  [/activity|history|log\b|moreRuns/i, 'IconHistory'],
  // A job's page is reached from a finding.
  [/openJob/i, 'IconSync'],

  // Above the settings rule, since the lock's keys live under `settings.`.
  [/unlock/i, 'IconUnlock'],
  [/lock/i, 'IconLock'],

  // A button that opens a menu of further actions.
  [/\.options$|\.more$/i, 'IconMore'],
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
