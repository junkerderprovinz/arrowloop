// Copied verbatim from GlimStone 1.7.2, reference/selectScroll.ts.
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
