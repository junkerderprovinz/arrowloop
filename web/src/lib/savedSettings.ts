// What the phone's target form sends on save. Saving writes only the keys it
// is sent (remotes.Save), so a field emptied on a saved target has to arrive
// empty, or the old value stays.

/** Just enough of a saved setting for this to decide. */
export type SavedSetting = { key: string; secret: boolean }

/**
 * The form's values ready to save. An emptied field the target has clears that
 * setting, and any other empty one is left out. A secret's field is empty while
 * a new one is typed, and left empty it means keep the saved one.
 */
export function settingsToSave(values: Record<string, string>, saved: SavedSetting[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== '') out[key] = value
    else if (saved.some((s) => s.key === key && !s.secret)) out[key] = ''
  }
  return out
}

/**
 * Whether the saved target has a value for any of these keys. A fold holding
 * them starts open then, so a setting that is in use is never out of sight.
 */
export function anySaved(saved: { key: string; value: string }[], keys: string[]): boolean {
  return saved.some((s) => s.value !== '' && keys.includes(s.key))
}
