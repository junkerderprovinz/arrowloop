// A value a field cannot take, such as a port above 65535 or an empty name,
// stands as a line under the field until the value is fixed. It is not a
// toast and nothing shakes: those answer an action that failed (design
// language, "Failure feedback").

export interface FieldErrorView {
  invalid: true | undefined;
  describedBy: string | undefined;
  /** The id of the line under the field, while there is one. */
  errorId: string | undefined;
}

/** What a field with `error` carries: aria-invalid, and the line as the last of its descriptions. */
export function fieldErrorView(error: string | undefined, id: string, describedBy?: string): FieldErrorView {
  if (!error) return { invalid: undefined, describedBy, errorId: undefined };
  const errorId = `${id}-error`;
  return { invalid: true, describedBy: describedBy ? `${describedBy} ${errorId}` : errorId, errorId };
}

export interface FieldNoteView {
  /** The id of the quiet line under the field, while there is one. */
  noteId: string | undefined;
  describedBy: string | undefined;
}

/** What a field with `note` carries: the quiet line as one of its descriptions, unless an error stands in its place. */
export function fieldNoteView(note: string | undefined, error: string | undefined, id: string, describedBy?: string): FieldNoteView {
  if (!note || error) return { noteId: undefined, describedBy };
  const noteId = `${id}-note`;
  return { noteId, describedBy: describedBy ? `${describedBy} ${noteId}` : noteId };
}
