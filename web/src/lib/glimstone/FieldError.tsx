import type { ReactNode } from "react";
import { TOAST_MARKS } from "../marks.ts";
import { MarkSvg } from "./glyphs.tsx";

/** The line under a field whose value it cannot take, with the fault mark.
 *  The fields draw it from their `error`; an app's own field draws it with
 *  the id its aria-describedby names. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span data-glim="FieldError" id={id} className="glim-field-error">
      <MarkSvg mark={TOAST_MARKS.fail} />
      {children}
    </span>
  );
}
