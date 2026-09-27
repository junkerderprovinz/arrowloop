/** The part of a target this needs, so the phone's own type fits as well. */
type Target = { type: string; settings: { key: string; value: string }[] }

/**
 * Reports whether a target is only a folder on this device rather than storage
 * elsewhere. An alias is judged by what it points at; any other backend that is
 * not `local` counts as elsewhere, known to the app or not.
 */
export function isLocalTarget(target: Target): boolean {
  if (target.type === 'local') return true
  if (target.type !== 'alias') return false
  const points = target.settings.find((s) => s.key === 'remote')?.value ?? ''
  return isLocalPath(points)
}

/** Reports whether a value is a path on this device rather than a target reference. */
function isLocalPath(value: string): boolean {
  if (!value) return false
  return value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)
}
