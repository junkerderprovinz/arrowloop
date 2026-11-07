// Whether the last input was a pointer rather than a key. Focus often lands on
// one element after the user acted on another, such as a dialog handing focus
// back to its opener, so it is tracked for the whole page. A bubble opens on
// focus only for keyboard users; a mouse user gets focus as a side effect.
//
// Not `:focus-visible`: jsdom evaluates it after a framework's focus handler
// runs, so inside the handler it reads false for keyboard focus too.

let pointer = false;
let tracking = false;

/** Starts listening once per page; later calls do nothing. */
export function trackInputModality(): void {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener("pointerdown", () => (pointer = true), true);
  document.addEventListener("keydown", () => (pointer = false), true);
}

export function pointerWasLast(): boolean {
  return pointer;
}
