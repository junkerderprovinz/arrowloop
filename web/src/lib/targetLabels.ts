/**
 * What each target is called on screen, by its id. A job's side writes the id
 * before the colon, and the id never changes when somebody renames the target,
 * so every place that names a side looks the label up here. Plain TypeScript,
 * shared with the phone. The api modules fill it whenever they read the
 * targets.
 */
const labels = new Map<string, string>()

export function learnTargets(targets: readonly { name: string; label?: string }[]): void {
  labels.clear()
  for (const t of targets) if (t.label) labels.set(t.name, t.label)
}

/** The label of the target with this id, or the id for one not read yet. */
export function targetLabel(id: string): string {
  return labels.get(id) || id
}

// Two characters at least before the colon, so a Windows drive letter stays a
// folder, and a registered drive has its own form.
const TARGET = /^([^:/\\]{2,}):([\s\S]*)$/

/**
 * A side as a person reads it: on a target, its label and the folder there,
 * `Home Lab - Keller: home/a`, since the stored form starts with the id. Any
 * other side is shown as written.
 */
export function labelledSide(side: string): string {
  const target = side.startsWith('volume:') ? null : TARGET.exec(side)
  if (!target) return side
  const [, id, folder] = target
  return folder ? `${targetLabel(id!)}: ${folder}` : targetLabel(id!)
}
