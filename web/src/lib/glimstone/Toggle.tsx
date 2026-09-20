// The shared switch control.
//
// The focus ring is `--focus-ring`, like every other shared control's, and
// `outline-offset-2` keeps it on the card surface, the background its 3:1
// contrast was measured against. The label is always the accessible name;
// `hideLabel` only drops the visible caption. Indenting a sub-switch is the
// caller's layout, per the design language's "flush, no indent" rule.

export interface ToggleProps {
  /** Current on/off state. */
  checked: boolean;
  /** Called with the flipped value when the switch is activated. */
  onChange: (next: boolean) => void;
  /** Always used as the accessible name; shown as visible text unless hideLabel. */
  label: string;
  /** Suppress the visible caption; the text stays as aria-label. Use it only
   *  when the caller draws the same text right next to the switch, never
   *  because a card title further up already says it. */
  hideLabel?: boolean;
  disabled?: boolean;
  /** Extra classes for the outer wrapper (e.g. row-alignment nudges). */
  className?: string;
}

export function Toggle({ checked, onChange, label, hideLabel = false, disabled, className }: ToggleProps) {
  return (
    <span className={`inline-flex items-center gap-2${className ? ` ${className}` : ""}`}>
      {!hideLabel && <span className="text-sm text-carbon-text">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        // No `title=`: the label is always visible beside the switch, so a
        // tooltip would only repeat it.
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring) disabled:opacity-50 ${
          checked ? "bg-accent" : "bg-carbon-surface3"
        }`}
      >
        <span
          // `translate-x` is physical, but the flex track already mirrors the
          // thumb's rest position under RTL, so `rtl:` negates the shift. The
          // `!` decides between two equally specific `translate` rules. The
          // variant follows the page's direction while the flex base follows
          // the nearest `dir` ancestor, so a Toggle must not sit inside a
          // container that overrides `dir`; pin only the text with a span.
          //
          // The thumb reads the same `--radius-pill` as the track so both
          // reshape together, and at "round" it stays a circle.
          className={`inline-block h-3.5 w-3.5 rounded-pill bg-carbon-background transition-transform ${
            checked ? "translate-x-[18px] rtl:-translate-x-[18px]!" : "translate-x-[3px] rtl:-translate-x-[3px]!"
          }`}
        />
      </button>
    </span>
  );
}
