import { useId, type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes } from "react";
import { textFieldClass, type FieldWidth } from "../field.ts";
import { fieldErrorView } from "../fieldError.ts";
import { FieldError } from "./FieldError.tsx";
import { useFieldName } from "./fieldName.ts";

export type { FieldWidth } from "../field.ts";

// A line of text and a few lines of text: borderless and filled, focus a step
// up the ramp (rule 14). The props are a native element's, so a call site swaps
// `<input className="glim-input"` for `<TextField` and keeps its own onChange.

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "width"> {
  /** The accessible name. Inside a FieldRow the row gives it. */
  label?: string;
  /** Sets a path or a token in monospace. */
  mono?: boolean;
  width?: FieldWidth;
  /** Why the value cannot stand, as a line under the field until it is fixed. */
  error?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, mono, width, error, className, type = "text", id, "aria-describedby": describedBy, ...rest }: TextFieldProps) {
  const name = useFieldName(label);
  const own = useId();
  const err = fieldErrorView(error, id ?? own, describedBy);
  return (
    <>
      <input
        data-glim="TextField"
        aria-label={name}
        {...rest}
        id={id}
        aria-invalid={err.invalid}
        aria-describedby={err.describedBy}
        type={type}
        className={`${textFieldClass({ width, mono })} ${className ?? ""}`.trim()}
      />
      {err.errorId && <FieldError id={err.errorId}>{error}</FieldError>}
    </>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** The accessible name. Inside a FieldRow the row gives it. */
  label?: string;
  /** Sets the text in monospace. */
  mono?: boolean;
  width?: FieldWidth;
  /** Why the value cannot stand, as a line under the field until it is fixed. */
  error?: string;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ label, mono, width, error, className, id, "aria-describedby": describedBy, ...rest }: TextAreaProps) {
  const name = useFieldName(label);
  const own = useId();
  const err = fieldErrorView(error, id ?? own, describedBy);
  return (
    <>
      <textarea
        data-glim="TextArea"
        aria-label={name}
        {...rest}
        id={id}
        aria-invalid={err.invalid}
        aria-describedby={err.describedBy}
        className={`${textFieldClass({ width, mono, area: true })} ${className ?? ""}`.trim()}
      />
      {err.errorId && <FieldError id={err.errorId}>{error}</FieldError>}
    </>
  );
}
