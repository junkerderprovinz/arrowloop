import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from "react";
import { shake } from "../selectModel.ts";
import { useFieldName } from "./fieldName.ts";
import { useTipBubble } from "./useTipBubble.tsx";

// The shared switch control.
//
// The label is always the accessible name; `hideLabel` only drops the visible
// caption. Indenting a sub-switch is the caller's layout, per the design
// language's "flush, no indent" rule. The other props of a <button> go to the
// switch, which is what a script asks for its state. Inside a FieldRow the row
// names the switch and draws the words.

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children" | "type" | "role"> {
  /** Current on/off state. */
  checked: boolean;
  /** Called with the flipped value when the switch is activated. */
  onChange: (next: boolean) => void;
  /** Always used as the accessible name; shown as visible text unless hideLabel. Inside a FieldRow the row gives it. */
  label?: string;
  /** Suppress the visible caption; the text stays as aria-label. Use it only
   *  when the caller draws the same text right next to the switch, never
   *  because a card title further up already says it. */
  hideLabel?: boolean;
  disabled?: boolean;
  /** Why the switch cannot be flipped right now, as OLED while Light is chosen
   *  (`oledRefusal`). It keeps its state and its focus, its track dims, a press
   *  shakes it, and the reason is its bubble, or a line under the row on a
   *  touch screen. */
  refused?: string;
  /** Extra classes for the outer wrapper (e.g. row-alignment nudges). */
  className?: string;
}

export function Toggle({ checked, onChange, label, hideLabel = false, disabled, refused, className, style, onClick, ...rest }: ToggleProps) {
  const name = useFieldName(label);
  const frame = useRef<HTMLSpanElement>(null);
  const [shakes, setShakes] = useState(0);
  useEffect(() => (shakes > 0 ? shake(frame.current!) : undefined), [shakes]);
  const tip = useTipBubble(refused);
  const reason = useId();
  return (
    <>
      <span ref={frame} className={`glim-toggle${className ? ` ${className}` : ""}`} style={style}>
        {label !== undefined && !hideLabel && <span className="glim-toggle-label">{label}</span>}
        {/* No `title=`: the label is always visible beside the switch, so a
            tooltip would only repeat it. A refused switch's bubble says why. */}
        <button
          {...rest}
          {...(refused ? tip.handlers : {})}
          ref={tip.ref}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={name}
          aria-disabled={refused ? true : undefined}
          aria-describedby={refused ? reason : rest["aria-describedby"]}
          disabled={disabled}
          onClick={(e) => {
            onClick?.(e);
            if (refused) setShakes((n) => n + 1);
            else onChange(!checked);
          }}
          className="glim-toggle-track"
        >
          <span className="glim-toggle-thumb" />
        </button>
      </span>
      {refused && (
        <span id={reason} className="glim-toggle-refusal">
          {refused}
        </span>
      )}
      {tip.bubble}
    </>
  );
}
