/** The engine's calls the target form saves with. */
export interface TargetCalls {
  addRemote: (body: { label: string; type: string; settings: Record<string, string> }) => Promise<{ saved: string }>;
  saveRemote: (
    id: string,
    body: { label: string; type: string; settings: Record<string, string> },
  ) => Promise<{ saved: string }>;
}

/** A name the form cannot save, as the sentence to show under the field. */
export interface NameRefusal {
  key: "targets.nameNeeded" | "targets.nameTaken";
  vars?: Record<string, string>;
}

/**
 * Saves the target form: a new target under the name typed, which the engine
 * makes an id from, and an edit under the id the target has, so a rename
 * changes that target and leaves no copy behind. Answers the id, or why the
 * name was refused; any other failure is thrown.
 */
export async function saveTarget(
  calls: TargetCalls,
  existing: string | undefined,
  typed: string,
  form: { type: string; settings: Record<string, string> },
): Promise<{ saved: string } | { refused: NameRefusal }> {
  const label = typed.trim();
  if (!label) return { refused: { key: "targets.nameNeeded" } };
  const body = { ...form, label };
  try {
    return existing ? await calls.saveRemote(existing, body) : await calls.addRemote(body);
  } catch (e) {
    if ((e as { code?: string }).code === "target-name-taken") {
      return { refused: { key: "targets.nameTaken", vars: { name: label } } };
    }
    throw e;
  }
}
