import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { textFieldClass, type FieldWidth } from "../field.ts";
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
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, mono, width, className, type = "text", ...rest }: TextFieldProps) {
  const name = useFieldName(label);
  return <input aria-label={name} {...rest} type={type} className={`${textFieldClass({ width, mono })} ${className ?? ""}`.trim()} />;
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** The accessible name. Inside a FieldRow the row gives it. */
  label?: string;
  /** Sets the text in monospace. */
  mono?: boolean;
  width?: FieldWidth;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ label, mono, width, className, ...rest }: TextAreaProps) {
  const name = useFieldName(label);
  return <textarea aria-label={name} {...rest} className={`${textFieldClass({ width, mono, area: true })} ${className ?? ""}`.trim()} />;
}
