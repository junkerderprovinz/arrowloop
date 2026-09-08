// Copied verbatim from GlimStone 1.7.7, reference/selectScroll.ts.
// Do not edit here: change it in the design language repo and copy again.
// https://github.com/junkerderprovinz/glimstone
// Rule 14's mouse-wheel addendum: a closed <select> answers the wheel too,
// stepping selectedIndex up or down and firing change, without opening the
// native dropdown. The platform default only wires the wheel up once a
// <select> is already open - this closes that gap for the values people
// reach for constantly (a font, a preset, a language) so they don't cost a
// click first.
//
// Framework-free, like appearance.ts: talks only to the <select> element
// it's given.

/** Attaches the behaviour to one <select>. Idempotent - safe to call twice. */
export function enableSelectScroll(select: HTMLSelectElement): void {
  if (select.dataset['glimScroll'] === '1') return;
  select.dataset['glimScroll'] = '1';

  select.addEventListener(
    'wheel',
    (event) => {
      if (select.disabled || select.options.length < 2) return;
      // Prevents the page itself from scrolling while the pointer sits over
      // the control - this handler is the scroll, not a bystander to it.
      event.preventDefault();

      const delta = event.deltaY > 0 ? 1 : -1;
      const next = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + delta));
      if (next === select.selectedIndex) return;

      select.selectedIndex = next;
      // A real 'change' event, not a manual state write - every existing
      // onChange/addEventListener('change') call site picks this up for
      // free, the same way a click on an <option> already would.
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { passive: false },
  );
}

/** Attaches the behaviour to every <select> under root - the usual boot-time call. */
export function enableSelectScrollForAll(root: ParentNode = document): void {
  for (const select of root.querySelectorAll('select')) {
    enableSelectScroll(select as HTMLSelectElement);
  }
}

/**
 * The same promise, for a picker that is NOT a native <select>.
 *
 * Rule 18 says a native control gets replaced rather than persuaded, and an app
 * that follows it ends up with no <select> left for the function above to reach.
 * The behaviour must not be lost on the way: jdp, about an app that had just
 * finished replacing its last one, "Dropdownlisten soll man ueberall auch per
 * scrollen umschalten koennen." So the wheel belongs to the PICKER, not to the
 * element the platform happens to draw.
 *
 * Attach it to the trigger - the button that opens the list - and return the
 * detach. `step` receives 1 for a wheel roll downwards and -1 for one upwards;
 * the caller clamps at both ends, because a picker that wraps from the last
 * value to the first turns one notch too many into a value from the other end of
 * the list.
 *
 * WHY THIS IS A LISTENER AND NOT AN onWheel PROP, which is the part worth
 * knowing before somebody simplifies it away: React registers `onWheel` as a
 * PASSIVE listener on its root, so `preventDefault` inside such a handler does
 * nothing but log a warning. The page would scroll while the value changed,
 * which is the one behaviour this feature exists to avoid. A listener attached
 * to the node with `{ passive: false }` is the only version that works, in every
 * framework and in none.
 */
export function enableWheelStep(el: HTMLElement, step: (delta: 1 | -1) => void): () => void {
  function onWheel(event: WheelEvent) {
    if (event.deltaY === 0) return;
    // This handler IS the scroll while the pointer sits on the control, rather
    // than a bystander to it.
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
