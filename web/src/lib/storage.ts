// Every key GlimStone keeps in localStorage starts with one prefix, so an app
// that has stored its choices under its own name, such as `bv-labels-buttons`,
// keeps them when it moves to the package.

let prefix = "glim";

/** Call once at boot, before anything reads a stored choice. */
export function setStoragePrefix(next: string): void {
  prefix = next;
}

export function storageKey(name: string): string {
  return `${prefix}-${name}`;
}
