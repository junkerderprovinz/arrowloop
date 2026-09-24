// The colour picker (design-language.md, "The colour engine"): a
// saturation/value square and a hue bar drawn in the page's own DOM.
// `colorPicker()` returns the bare widget; `openColorPickerPopover()` wraps it
// in a panel anchored to a trigger, the default for a compact settings card.
//
// A native `<input type="color">` can open the OS picker in a separate window,
// outside the page, where no Playwright check can reach it either.

// The arithmetic lives in colorMath.ts, because the phone mixes the same
// colours and cannot load a file that builds DOM elements. A colour mixed
// there and the same colour mixed here have to be the same six digits.
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from './colorMath';

export interface ColorPicker {
  /** The root element; append it wherever the picker should render. */
  el: HTMLDivElement;
  /** Sync the picker to a hex value without firing onChange. */
  setValue: (hex: string) => void;
  /** The picker's current value as a 6-digit lowercase hex string. */
  getValue: () => string;
}

/**
 * Builds an always-visible saturation/value square and hue bar. `onChange`
 * fires with a 6-digit lowercase hex string on every mouse or touch drag
 * update; a caller that writes to disk should debounce it.
 */
export function colorPicker(initialHex: string, onChange: (hex: string) => void): ColorPicker {
  const el = document.createElement('div');
  el.className = 'glim-picker';

  const sv = document.createElement('div');
  sv.className = 'glim-picker-sv';
  const dot = document.createElement('span');
  dot.className = 'glim-picker-dot';
  sv.appendChild(dot);

  const hue = document.createElement('div');
  hue.className = 'glim-picker-hue';
  const hdot = document.createElement('span');
  hdot.className = 'glim-picker-hdot';
  hue.appendChild(hdot);

  el.append(sv, hue);

  let state: Hsv = hexToHsv(initialHex) || { h: 220, s: 0.8, v: 0.9 };

  function paint(): void {
    sv.style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${Math.round(state.h)},100%,50%))`;
    dot.style.left = `${state.s * 100}%`;
    dot.style.top = `${(1 - state.v) * 100}%`;
    hdot.style.left = `${(state.h / 360) * 100}%`;
  }

  function emit(): void {
    onChange(hsvToHex(state.h, state.s, state.v));
  }

  function drag(target: HTMLElement, apply: (x: number, y: number) => void): void {
    function move(event: MouseEvent | TouchEvent): void {
      const rect = target.getBoundingClientRect();
      const point = 'touches' in event ? (event.touches[0] ?? event.changedTouches[0]) : event;
      if (!point) return;
      const x = Math.min(1, Math.max(0, (point.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (point.clientY - rect.top) / rect.height));
      apply(x, y);
      paint();
      emit();
      event.preventDefault();
    }
    function up(): void {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    }
    function down(event: MouseEvent | TouchEvent): void {
      move(event);
      document.addEventListener('mousemove', move as EventListener);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move as EventListener);
      document.addEventListener('touchend', up);
    }
    target.addEventListener('mousedown', down as EventListener);
    target.addEventListener('touchstart', down as EventListener);
  }

  drag(sv, (x, y) => {
    state = { ...state, s: x, v: 1 - y };
  });
  drag(hue, (x) => {
    state = { ...state, h: Math.min(359.9, x * 360) };
  });

  paint();

  return {
    el,
    setValue: (hex: string) => {
      const parsed = hexToHsv(hex);
      if (parsed) {
        state = parsed;
        paint();
      }
    },
    getValue: () => hsvToHex(state.h, state.s, state.v),
  };
}

export interface ColorPickerPopoverHandle {
  /** Closes the popover; an outside click, Escape, scroll or resize also does. */
  close: () => void;
}

let openPopover: { el: HTMLDivElement; close: () => void } | null = null;

/**
 * Opens the picker as a popover anchored below `trigger`, so a settings card
 * does not grow with every colour field. Reserve the bare `colorPicker()` for a
 * page with permanent space for one control. Opening a popover closes the one
 * already open.
 */
export function openColorPickerPopover(
  trigger: HTMLElement,
  initialHex: string,
  onChange: (hex: string) => void,
  onClose?: () => void,
): ColorPickerPopoverHandle {
  openPopover?.close();

  const panel = document.createElement('div');
  panel.className = 'glim-picker-popover';

  // Dragging updates the hex text, and typing a valid hex moves the picker.
  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'glim-picker-hex';
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexInput.value = initialHex;
  hexInput.setAttribute('aria-label', 'Hex');

  const picker = colorPicker(initialHex, (hex) => {
    hexInput.value = hex;
    onChange(hex);
  });

  hexInput.addEventListener('input', () => {
    const normalized = normalizeHex(hexInput.value);
    if (!normalized) return;
    picker.setValue(normalized);
    onChange(normalized);
  });

  panel.append(picker.el, hexInput);
  document.body.appendChild(panel);

  function position(): void {
    const rect = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.max(8, Math.min(vw - 8 - width, rect.left));
    const fitsBelow = rect.bottom + 8 + height <= vh;
    const top = fitsBelow ? rect.bottom + 8 : Math.max(8, rect.top - 8 - height);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
  position();

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    panel.remove();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    if (openPopover?.el === panel) openPopover = null;
    // Re-rendering the trigger's row while the popover is open strands the
    // outside-click handler on a detached node, so a caller that redraws the
    // row applies the colour in `onChange` and redraws here.
    onClose?.();
  }
  // The trigger is excluded so a second click on it reaches the caller's own
  // click handler and reopens the picker.
  function onPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Node && (panel.contains(target) || trigger.contains(target))) return;
    close();
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown);
  // A fixed-position popover loses its anchor on scroll or resize.
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);

  openPopover = { el: panel, close };
  return { close };
}
