import { placeOf } from './entryLabel'

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

/**
 * Reports whether a job's side reaches over the network, that is names a
 * target that is not a folder on this device. A target the list does not
 * know counts as the network, since it may well be one.
 */
export function overNetwork(path: string, targets: (Target & { name: string })[]): boolean {
  const place = placeOf(path, [])
  if (place.kind !== 'target') return false
  const target = targets.find((t) => t.name === place.name)
  return !target || !isLocalTarget(target)
}

/** Reports whether a value is a path on this device rather than a target reference. */
function isLocalPath(value: string): boolean {
  if (!value) return false
  return value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)
}
