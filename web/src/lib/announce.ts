// Words for a screen reader that have no element of their own to live in, such
// as "3 rows selected" or a toast. A live region announces a change of its
// content, not its arrival, so the regions have to be in the page before the
// first message: ToastViewport renders both for good, and announce() adds them
// to <body> in an app that has no viewport.

export type Politeness = "polite" | "assertive";

/** The attributes of the region for one politeness, beside the class
 *  `glim-sr-only`. A polite region is a status; the assertive one is an alert
 *  and is for failures alone. */
export function liveRegionAttrs(politeness: Politeness): Record<string, string> {
  return {
    role: politeness === "assertive" ? "alert" : "status",
    "aria-live": politeness,
    "aria-atomic": "true",
    "data-glim-announce": politeness,
  };
}

// The region is emptied first and filled a moment later, so the same words
// said twice are read twice.
const SETTLE_MS = 100;

/** Has the screen reader say `text`. "assertive" interrupts it and belongs to
 *  failures; everything else is "polite". */
export function announce(text: string, politeness: Politeness = "polite"): void {
  // A region behind an open window is inert and out of a screen reader's reach.
  let region = [...document.querySelectorAll<HTMLElement>(`[data-glim-announce="${politeness}"]`)].find((r) => !r.closest("[inert]"));
  if (!region) {
    region = document.createElement("div");
    region.className = "glim-sr-only";
    for (const [k, v] of Object.entries(liveRegionAttrs(politeness))) region.setAttribute(k, v);
    document.body.append(region);
  }
  const target = region;
  target.textContent = "";
  setTimeout(() => {
    target.textContent = text;
  }, SETTLE_MS);
}
