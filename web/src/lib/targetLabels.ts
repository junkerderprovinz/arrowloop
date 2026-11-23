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
