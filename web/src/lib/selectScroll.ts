// Rule 14's mouse-wheel addendum: a closed <select> with focus answers the
// wheel, stepping selectedIndex and firing change without opening the native
// dropdown. Browsers only wire the wheel up once a <select> is open. Focus is
// the condition a number field has too: a list of rows with a dropdown each
// would otherwise change whatever the page scrolls past.

/** Attaches the behaviour to one <select>. Safe to call twice. */
export function enableSelectScroll(select: HTMLSelectElement): void {
  if (select.dataset['glimScroll'] === '1') return;
  select.dataset['glimScroll'] = '1';

  select.addEventListener(
    'wheel',
    (event) => {
      if (select.disabled || select.options.length < 2) return;
      if (select.ownerDocument.activeElement !== select) return;
      // The wheel steps the value, so the page must not scroll under it.
      event.preventDefault();

      const delta = event.deltaY > 0 ? 1 : -1;
      const next = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + delta));
      if (next === select.selectedIndex) return;

      select.selectedIndex = next;
      // A real change event, so existing change handlers pick it up as they
      // would a click on an <option>.
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { passive: false },
  );
}

/** Attaches the behaviour to every <select> under root, usually at boot. */
export function enableSelectScrollForAll(root: ParentNode = document): void {
  for (const select of root.querySelectorAll('select')) {
    enableSelectScroll(select as HTMLSelectElement);
  }
}

/**
 * The same behaviour for a custom picker that replaced a native <select> (rule
 * 18). Attach it to the button that opens the list; it returns the detach.
 * It steps only while that button has focus, which it gets back when the list
 * closes.
 * `step` receives 1 for a roll downwards and -1 for one upwards, and the caller
 * clamps at both ends rather than wrapping.
 *
 * This is a listener rather than an `onWheel` prop because React registers
 * `onWheel` as passive, where `preventDefault` does nothing and the page would
 * scroll while the value changed.
 */
export function enableWheelStep(el: HTMLElement, step: (delta: 1 | -1) => void): () => void {
  function onWheel(event: WheelEvent) {
    if (event.deltaY === 0 || el.ownerDocument.activeElement !== el) return;
    event.preventDefault();
    step(event.deltaY > 0 ? 1 : -1);
  }
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}

/** Where a wheel notch lands in a list of options: the next index, clamped. */
export function stepIndex(length: number, at: number, delta: 1 | -1): number {
  if (length < 2) return at;
  return Math.min(length - 1, Math.max(0, at + delta));
}
