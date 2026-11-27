// The target a wrapping target such as crypt is built on, and the targets a
// union or combine joins. rclone finds a target by its id, the section name in
// rclone.conf, so a form that offers targets by their label still writes ids.

export interface KnownTarget {
  name: string
  label?: string
}

/** A target and a folder on it. An empty target means a folder on this machine. */
export interface Wrapped {
  target: string
  folder: string
}

/** One entry of a union or combine. */
export interface Upstream extends Wrapped {
  /** The folder name a combine shows the entry under. */
  dir?: string
  /** A union entry's :ro, :nc or :writeback, kept as it was. */
  mode: string
}

/** How a target reads in a list of targets: its label, and its id where that differs. */
export function targetChoiceLabel(target: KnownTarget): string {
  const label = target.label || target.name
  return label === target.name ? label : `${label} (${target.name})`
}

/**
 * Reads a remote setting. A target written by its label is read as the target
 * it names, which rclone cannot find, so saving the form again repairs it.
 */
export function splitWrapped(value: string, targets: KnownTarget[]): Wrapped {
  const colon = value.indexOf(':')
  if (colon > 0) {
    const before = value.slice(0, colon)
    const found = targets.find((t) => t.name === before) ?? targets.find((t) => t.label === before)
    if (found) return { target: found.name, folder: value.slice(colon + 1) }
  }
  return { target: '', folder: value }
}

export function joinWrapped({ target, folder }: Wrapped): string {
  const inside = folder.trim()
  return target ? `${target}:${inside}` : inside
}

const MODES = [':writeback', ':ro', ':nc']

/** Reads an upstreams setting, which rclone reads as one CSV record with spaces between the fields. */
export function splitUpstreams(value: string, targets: KnownTarget[], combine: boolean): Upstream[] {
  return spaceList(value).map((entry) => {
    let dir: string | undefined
    if (combine) {
      const equal = entry.indexOf('=')
      if (equal >= 0) {
        dir = entry.slice(0, equal)
        entry = entry.slice(equal + 1)
      }
    }
    const mode = combine ? '' : (MODES.find((m) => entry.endsWith(m)) ?? '')
    const wrapped = splitWrapped(entry.slice(0, entry.length - mode.length), targets)
    return dir === undefined ? { ...wrapped, mode } : { dir, ...wrapped, mode }
  })
}

export function joinUpstreams(list: Upstream[], combine: boolean): string {
  return list
    .filter((u) => u.target || u.folder.trim())
    .map((u) => {
      const entry = joinWrapped(u) + u.mode
      return quoted(combine ? `${(u.dir ?? '').trim()}=${entry}` : entry)
    })
    .join(' ')
}

// The fields of a CSV record whose separator is a space, as Go's
// encoding/csv reads it. The empty fields that a run of spaces makes are left
// out, since an empty upstream is never meant.
function spaceList(value: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < value.length) {
    if (value[i] === ' ') {
      i++
      continue
    }
    let field = ''
    if (value[i] === '"') {
      i++
      while (i < value.length) {
        if (value[i] === '"' && value[i + 1] === '"') {
          field += '"'
          i += 2
        } else if (value[i] === '"') {
          i++
          break
        } else {
          field += value[i++]
        }
      }
    }
    while (i < value.length && value[i] !== ' ') field += value[i++]
    out.push(field)
  }
  return out
}

function quoted(field: string): string {
  return /[ "]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field
}

/**
 * A form's settings with the targets in remote and upstreams written by their
 * ids, so a target written by its label is saved right the next time.
 */
export function withTargetIds(
  values: Record<string, string>,
  targets: KnownTarget[],
  combine: boolean,
): Record<string, string> {
  const out = { ...values }
  if (out.remote) out.remote = joinWrapped(splitWrapped(out.remote, targets))
  if (out.upstreams) out.upstreams = joinUpstreams(splitUpstreams(out.upstreams, targets, combine), combine)
  return out
}
