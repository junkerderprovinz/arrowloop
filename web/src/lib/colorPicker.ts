// The colour picker (design-language.md, "The colour engine"): a
// saturation/value square and a hue bar drawn in the page's own DOM.
// `colorPicker()` returns the bare widget; `openColorPickerPopover()` wraps it
// in a panel anchored to a trigger, the default for a compact settings card.
// The ColorPicker components of React and Vue mount the same widget and add the
// preview, the name and Apply around it.
//
// A native `<input type="color">` can open the OS picker in a separate window,
// outside the page, where no Playwright check can reach it either.

import { keepTabInside } from "./dialog.ts";
import { claimMenu, closeMenuOutside } from "./menu.ts";

// The arithmetic lives in colorMath.ts, because the phone mixes the same
// colours and cannot load a file that builds DOM elements. A colour mixed
// there and the same colour mixed here have to be the same six digits.
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from './colorMath';

export { hexToHsv, hsvToHex, normalizeHex, type Hsv };

export interface ColorPicker {
  /** The root element; append it wherever the picker should render. */
  el: HTMLDivElement;
  /** Sync the picker to a hex value without firing onChange. */
  setValue: (hex: string) => void;
  /** The picker's current value as a 6-digit lowercase hex string. */
  getValue: () => string;
  /** Moves the focus to the square, where the arrow keys move the handle. */
  focus: () => void;
}

export interface ColorPickerText {
  /** The square's accessible name. */
  area: string;
  /** The hue bar's accessible name. */
  hue: string;
}

/** The words of the ColorPicker components: the widget's two names, the hex field's and Apply. */
export interface ColorPickerPanelText extends ColorPickerText {
  hex: string;
  apply: string;
}

export const COLOR_PICKER_TEXT: ColorPickerPanelText = {
  area: "Saturation and brightness",
  hue: "Hue",
  hex: "Hex",
  apply: "Apply",
};

const HUE_MAX = 359.9;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * What an arrow key does to the picker: on the square left and right move the
 * saturation and up and down the brightness, on the hue bar every arrow moves
 * the hue. Shift takes bigger steps, Home and End go to an end of the bar.
 * Returns null for a key the picker leaves alone.
 */
function pickerKeyStep(part: "area" | "hue", key: string, shift: boolean, hsv: Hsv): Hsv | null {
  if (part === "hue") {
    if (key === "Home") return { ...hsv, h: 0 };
    if (key === "End") return { ...hsv, h: HUE_MAX };
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[key];
    return dir ? { ...hsv, h: clamp(hsv.h + dir * (shift ? 30 : 3), 0, HUE_MAX) } : null;
  }
  const step = shift ? 0.1 : 0.02;
  const ds = { ArrowRight: 1, ArrowLeft: -1 }[key] ?? 0;
  const dv = { ArrowUp: 1, ArrowDown: -1 }[key] ?? 0;
  if (!ds && !dv) return null;
  return { ...hsv, s: clamp(hsv.s + ds * step, 0, 1), v: clamp(hsv.v + dv * step, 0, 1) };
}

/**
 * Builds an always-visible saturation/value square and hue bar. `onChange`
 * fires with a 6-digit lowercase hex string on every step of a drag with
 * mouse, pen or finger and on every arrow key; a caller that writes to disk
 * should debounce it.
 */
export function colorPicker(
  initialHex: string,
  onChange: (hex: string) => void,
  options: { text?: Partial<ColorPickerText> } = {},
): ColorPicker {
  const text: ColorPickerText = { area: COLOR_PICKER_TEXT.area, hue: COLOR_PICKER_TEXT.hue, ...options.text };
  const el = document.createElement("div");
  el.className = "glim-picker";

  const sv = document.createElement("div");
  sv.className = "glim-picker-sv";
  sv.tabIndex = 0;
  sv.setAttribute("role", "slider");
  sv.setAttribute("aria-label", text.area);
  const dot = document.createElement("span");
  dot.className = "glim-picker-dot";
  sv.appendChild(dot);

  const hue = document.createElement("div");
  hue.className = "glim-picker-hue";
  hue.tabIndex = 0;
  hue.setAttribute("role", "slider");
  hue.setAttribute("aria-label", text.hue);
  hue.setAttribute("aria-valuemin", "0");
  hue.setAttribute("aria-valuemax", "360");
  const hdot = document.createElement("span");
  hdot.className = "glim-picker-hdot";
  hue.appendChild(hdot);

  el.append(sv, hue);

  let state: Hsv = hexToHsv(initialHex) || { h: 220, s: 0.8, v: 0.9 };

  function paint(): void {
    const hex = hsvToHex(state.h, state.s, state.v);
    sv.style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${Math.round(state.h)},100%,50%))`;
    dot.style.left = `${state.s * 100}%`;
    dot.style.top = `${(1 - state.v) * 100}%`;
    hdot.style.left = `${(state.h / 360) * 100}%`;
    el.style.setProperty("--glim-picker-colour", hex);
    // The square moves along two axes, so the one value that names its place is the colour itself.
    sv.setAttribute("aria-valuetext", hex);
    hue.setAttribute("aria-valuenow", String(Math.round(state.h)));
  }

  function emit(): void {
    onChange(hsvToHex(state.h, state.s, state.v));
  }

  // Pointer capture keeps the drag going once the pointer leaves the square,
  // for mouse, pen and finger alike, with no listener on the document.
  function drag(target: HTMLElement, apply: (x: number, y: number) => void): void {
    function at(event: PointerEvent): void {
      const rect = target.getBoundingClientRect();
      apply(clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1));
      paint();
      emit();
    }
    target.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      target.focus();
      target.setPointerCapture(event.pointerId);
      at(event);
    });
    target.addEventListener("pointermove", (event) => {
      if (target.hasPointerCapture(event.pointerId)) at(event);
    });
  }

  drag(sv, (x, y) => {
    state = { ...state, s: x, v: 1 - y };
  });
  drag(hue, (x) => {
    state = { ...state, h: Math.min(HUE_MAX, x * 360) };
  });

  for (const [part, target] of [["area", sv], ["hue", hue]] as const) {
    target.addEventListener("keydown", (event) => {
      const next = pickerKeyStep(part, event.key, event.shiftKey, state);
      if (!next) return;
      event.preventDefault();
      state = next;
      paint();
      emit();
    });
  }

  paint();

  return {
    el,
    setValue: (hex: string) => {
      const parsed = hexToHsv(hex);
      if (!parsed) return;
      // A grey or black has no hue of its own, so the bar stays where it was.
      state = parsed.s === 0 || parsed.v === 0 ? { ...parsed, h: state.h } : parsed;
      paint();
    },
    getValue: () => hsvToHex(state.h, state.s, state.v),
    focus: () => sv.focus(),
  };
}

interface Box {
  width: number;
  height: number;
}

/**
 * Where a picker panel goes beside its trigger: below it when it fits, above
 * it otherwise, and always 8px inside the window.
 */
export function placeColorPicker(
  trigger: { left: number; top: number; bottom: number },
  panel: Box,
  view: Box,
): { left: number; top: number } {
  const left = Math.max(8, Math.min(view.width - 8 - panel.width, trigger.left));
  const fitsBelow = trigger.bottom + 8 + panel.height <= view.height;
  const top = fitsBelow ? trigger.bottom + 8 : Math.max(8, trigger.top - 8 - panel.height);
  return { left, top };
}

/** The size of the window without its scroll bars, for placing a panel in it. */
export function viewportSize(): Box {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

/**
 * Lets a ColorPicker panel float beside the control that opened it. It is the
 * document's one open menu, so Escape and a click beside it close the picker
 * before a window under it, and opening a menu closes the picker. Tab stays
 * inside the panel, and a scroll or resize closes it, since a fixed panel
 * loses its anchor. `close` hears whether Escape closed it; the focus is then
 * back on the anchor. Returns the cleanup.
 */
export function floatColorPicker(panel: HTMLElement, anchor: HTMLElement, close: (byEscape: boolean) => void): () => void {
  const at = placeColorPicker(anchor.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.offsetHeight }, viewportSize());
  panel.style.left = `${at.left}px`;
  panel.style.top = `${at.top}px`;

  const release = claimMenu((byEscape) => {
    if (byEscape) anchor.focus();
    close(byEscape);
  });
  const outside = closeMenuOutside(() => [panel, anchor], () => close(false));
  const away = (e: Event) => {
    if (!(e.target instanceof Node && panel.contains(e.target))) close(false);
  };
  // The panel sits on the body, outside any window, so a window's Tab trap
  // would pull the focus back out of it.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    keepTabInside(panel, e);
    e.stopPropagation();
  };
  window.addEventListener("scroll", away, true);
  window.addEventListener("resize", away);
  panel.addEventListener("keydown", onKey);
  return () => {
    release();
    outside();
    window.removeEventListener("scroll", away, true);
    window.removeEventListener("resize", away);
    panel.removeEventListener("keydown", onKey);
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

  const panel = document.createElement("div");
  panel.className = "glim-picker-popover";

  // Dragging updates the hex text, and typing a valid hex moves the picker.
  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "glim-picker-hex";
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexInput.value = initialHex;
  hexInput.setAttribute("aria-label", "Hex");

  const picker = colorPicker(initialHex, (hex) => {
    hexInput.value = hex;
    onChange(hex);
  });

  hexInput.addEventListener("input", () => {
    const normalized = normalizeHex(hexInput.value);
    if (!normalized) return;
    picker.setValue(normalized);
    onChange(normalized);
  });

  panel.append(picker.el, hexInput);
  document.body.appendChild(panel);

  function position(): void {
    const at = placeColorPicker(trigger.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.offsetHeight }, viewportSize());
    panel.style.left = `${at.left}px`;
    panel.style.top = `${at.top}px`;
  }
  position();

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    panel.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
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
    if (event.key === "Escape") close();
  }
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown);
  // A fixed-position popover loses its anchor on scroll or resize.
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);

  openPopover = { el: panel, close };
  return { close };
}
