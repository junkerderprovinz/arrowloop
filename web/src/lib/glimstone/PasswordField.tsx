import { useState, type InputHTMLAttributes, type Ref } from "react";
import { fieldWidthClass, type FieldWidth } from "../field.ts";
import { useFieldName } from "./fieldName.ts";
import { IconEye, IconEyeOff } from "./glyphs.tsx";
import { IconTipButton } from "./IconTipButton.tsx";

// A field for a secret with the reveal eye inside it ("The reveal eye" in the
// design language). The props are a native <input>'s, so a call site swaps
// `<input type="password"` for `<PasswordField` and keeps its own onChange.
// Inside a FieldRow the row names it.

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "width"> {
  width?: FieldWidth;
  /** Attributes for the eye, such as a data hook. */
  eyeAttrs?: Record<string, string>;
  /** The eye's name and bubble while the secret is hidden, and once it shows. */
  text?: { show: string; hide: string };
  /** Classes for the wrapper, which carries the field's width. */
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

export function PasswordField({ width, eyeAttrs, text = { show: "Show", hide: "Hide" }, className, ref, disabled, "aria-label": ariaLabel, ...rest }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const name = useFieldName(ariaLabel);
  return (
    <span className={["glim-secret", fieldWidthClass(width), className].filter(Boolean).join(" ")}>
      <input
        autoComplete="current-password"
        spellCheck={false}
        {...rest}
        aria-label={name}
        ref={ref}
        disabled={disabled}
        type={shown ? "text" : "password"}
        className="glim-input"
      />
      <IconTipButton {...eyeAttrs} tip={shown ? text.hide : text.show} className="glim-secret-eye" disabled={disabled} onClick={() => setShown(!shown)}>
        {shown ? <IconEyeOff /> : <IconEye />}
      </IconTipButton>
    </span>
  );
}
