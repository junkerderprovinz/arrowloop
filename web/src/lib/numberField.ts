// The number field: no native spinner, two steppers of our own inside the box
// (docs/design-language.md, "Never a native number spinner either").
//
// A stepper is part of the field, not a control beside it: it has no ground of
// its own and only its ink changes on hover. The field carries enough inline
// padding that the digits never run underneath the arrows.
//
// It attaches to a plain `<input type="number">` and returns a teardown, so a
// React app calls it from a ref effect.

/** Everything the field needs from its host, all optional. */
export interface NumberFieldOptions {
  /**
   * Class put on each arrow button. `.glim-num-step` in tokens.css is enough;
   * an app that wants a different ink passes its own class.
   */
  buttonClass?: string;
}

// There is no labels option: the arrows are aria-hidden and out of the tab
// order, so a `title` would only paint the OS balloon the design language
// rejects.

/**
 * Whether a step in `direction` would change the value. `stepUp()` throws on a
 * bad value and clamps silently at the ends, so the disabled state needs this
 * answer without moving anything.
 */
export function wouldStep(input: HTMLInputElement, direction: 1 | -1): boolean {
  const step = Number(input.step) || 1;
  const raw = input.value === "" ? Number(input.min) || 0 : Number(input.value);
  if (!Number.isFinite(raw)) return true; // unparseable: let the browser decide
  const next = raw + direction * step;
  const min = input.min === "" ? -Infinity : Number(input.min);
  const max = input.max === "" ? Infinity : Number(input.max);
  return direction > 0 ? next <= max : next >= min;
}

/**
 * Give one `<input type="number">` a pair of in-field steppers and return a
 * teardown that unwraps it.
 *
 * The input is wrapped in a relatively positioned span so the arrows sit inside
 * the field's box without the host changing its layout. The buttons and the
 * wheel call `stepUp()`/`stepDown()`, so min, max and step stay in the markup,
 * then dispatch `input` and `change` by hand because `stepUp()` fires neither.
 */
export function attachNumberSteppers(
  input: HTMLInputElement,
  options: NumberFieldOptions = {},
): () => void {
  const doc = input.ownerDocument;

  const wrap = doc.createElement("span");
  wrap.className = "glim-num-wrap";
  input.parentNode?.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.classList.add("glim-num-input");

  const stack = doc.createElement("span");
  stack.className = "glim-num-steppers";
  // The input already carries the value, the range and the arrow keys; a screen
  // reader would hear these as a third control for the same number.
  stack.setAttribute("aria-hidden", "true");

  const make = (direction: 1 | -1, glyph: string) => {
    const b = doc.createElement("button");
    b.type = "button"; // inside a form, a bare <button> submits it
    b.className = "glim-num-step" + (options.buttonClass ? ` ${options.buttonClass}` : "");
    b.tabIndex = -1;
    b.innerHTML = glyph;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the field
    b.addEventListener("click", () => {
      if (input.disabled || input.readOnly) return;
      if (direction > 0) input.stepUp();
      else input.stepDown();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
    });
    return b;
  };

  // Solid triangles with rounded corners, drawn rather than typed so they do not
  // inherit the font, and filled to match the rest of the icon set. The corners
  // come from a matched stroke with a round join; the path is inset by half the
  // stroke width so the result is no larger than a sharp triangle.
  const ARROW = 'fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"';
  const up = make(1, `<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M5 1.7 L8.6 4.6 L1.4 4.6 Z" ${ARROW}/></svg>`);
  const down = make(-1, `<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M5 4.3 L1.4 1.4 L8.6 1.4 Z" ${ARROW}/></svg>`);

  stack.append(up, down);
  wrap.appendChild(stack);

  /** Grey out whichever arrow has nothing left to do. */
  function sync() {
    up.disabled = input.disabled || input.readOnly || !wouldStep(input, 1);
    down.disabled = input.disabled || input.readOnly || !wouldStep(input, -1);
  }

  /**
   * The wheel steps the value only while the field has focus, so scrolling past
   * a field cannot change it. It is registered as non-passive so preventDefault
   * stops the page from scrolling at the same time. Up is more; a trackpad
   * reports fractional deltas, so only the sign is read.
   */
  function wheel(e: WheelEvent) {
    if (input.disabled || input.readOnly) return;
    if (doc.activeElement !== input) return;
    if (e.deltaY === 0) return;
    const direction: 1 | -1 = e.deltaY < 0 ? 1 : -1;
    e.preventDefault();
    if (!wouldStep(input, direction)) return;
    if (direction > 0) input.stepUp();
    else input.stepDown();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
  }

  input.addEventListener("input", sync);
  input.addEventListener("change", sync);
  input.addEventListener("wheel", wheel, { passive: false });
  sync();

  return () => {
    input.removeEventListener("input", sync);
    input.removeEventListener("change", sync);
    input.removeEventListener("wheel", wheel);
    input.classList.remove("glim-num-input");
    wrap.parentNode?.insertBefore(input, wrap);
    wrap.remove();
  };
}
