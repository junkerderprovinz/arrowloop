// The marks the components draw themselves, as SVG data each framework puts
// into an <svg>. Every other icon is the app's own, asked for by meaning
// through a glyph resolver (glyphs.md).

export interface Mark {
  viewBox: string;
  /** The rendered size in px, square. */
  size: number;
  /** The SVG children, filled with currentColor. */
  body: string;
}

/**
 * The close mark: a plus rotated by 45 degrees, drawn as two rounded bars to
 * match the filled shapes of the assortment. The `2 2 10 10` viewBox is the box
 * every glyph in the set uses, so it carries the same optical weight as the
 * app's own icons.
 */
const close: Mark = {
  viewBox: "2 2 10 10",
  size: 16,
  body: '<g transform="rotate(45 7 7)"><rect x="2" y="5.9" width="10" height="2.2" rx="1.1"/><rect x="5.9" y="2" width="2.2" height="10" rx="1.1"/></g>',
};

export const MARKS = {
  close,
  /** The same shape as close, but dismissing a surface and abandoning an action
   *  mean different things at the call site, and an app may draw them apart. */
  cancel: close,
  /** The chosen option of a list, `IconCheck` from the assortment. */
  check: {
    viewBox: "0.3 0.549 13.399 13.399",
    size: 14,
    body: '<path fill-rule="evenodd" d="M4.381 12.219 L4.574 12.378 L4.793 12.497 L5.032 12.572 L5.155 12.592 L5.405 12.596 L5.651 12.552 L5.884 12.461 L6.096 12.328 L6.278 12.157 L13.457 3.957 L13.584 3.736 L13.666 3.495 L13.699 3.242 L13.683 2.988 L13.656 2.863 L13.566 2.625 L13.431 2.408 L13.257 2.222 L13.05 2.074 L12.936 2.016 L12.695 1.934 L12.442 1.901 L12.188 1.917 L11.942 1.983 L11.713 2.096 L11.511 2.251 L5.238 9.399 L2.519 6.681 L2.425 6.595 L2.213 6.454 L1.977 6.356 L1.854 6.325 L1.6 6.3 L1.346 6.325 L1.223 6.356 L0.987 6.454 L0.775 6.595 L0.595 6.775 L0.454 6.987 L0.399 7.103 L0.325 7.346 L0.3 7.6 L0.306 7.727 L0.356 7.977 L0.399 8.097 L0.519 8.322 L0.681 8.519Z"/>',
  },
  /** A closed list's trigger, `IconExpand` from the assortment. It turns over while the list is open. */
  expand: {
    viewBox: "3.6 2.95 12.8 12.8",
    size: 14,
    body: '<path d="M10 13.4 3.6 7l1.7-1.7L10 10l4.7-4.7L16.4 7 10 13.4Z"/>',
  },
  /** `IconWindowMinimise`: the bar the window goes down to. */
  windowMinimise: {
    viewBox: "0 0 14 14",
    size: 16,
    body: '<rect x="0" y="6" width="14" height="2" rx="1"/>',
  },
  /** `IconWindowMaximise`: the window filling the screen. */
  windowMaximise: {
    viewBox: "0 0 14 14",
    size: 16,
    body: '<path fill-rule="evenodd" clip-rule="evenodd" d="M2.5 0h9A2.5 2.5 0 0 1 14 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 0 11.5v-9A2.5 2.5 0 0 1 2.5 0Zm0 2a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5Z"/>',
  },
  /** `IconWindowRestore`: the window in front of the screen it filled. Not
   *  `IconRestore`, which brings a backup back. */
  windowRestore: {
    viewBox: "0 0 14 14",
    size: 16,
    body: '<path fill-rule="evenodd" clip-rule="evenodd" d="M2.5 3h6A2.5 2.5 0 0 1 11 5.5v6A2.5 2.5 0 0 1 8.5 14h-6A2.5 2.5 0 0 1 0 11.5v-6A2.5 2.5 0 0 1 2.5 3Zm0 2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-6a.5.5 0 0 0-.5-.5Z"/><path d="M5 0h6.5A2.5 2.5 0 0 1 14 2.5V9h-2V2.5a.5.5 0 0 0-.5-.5H5Z"/>',
  },
  /** `IconPencil`: the edit button at the end of a menu's heading. */
  pencil: {
    viewBox: "-0.002 -0.001 14.001 14.001",
    size: 14,
    body: '<path d="M10.715 -0.000976562c-0.1998 0 -0.3976 0.039922962 -0.5818 0.117424562 -0.18301 0.07702 -0.34892 0.18961 -0.48808 0.331228L1.40732 8.64549c-0.06116 0.06086 -0.10553 0.13651 -0.12879 0.21959L0.0185299 13.3651c-0.0487051 0.1739 0.0001992 0.3606 0.1279281 0.4884 0.12773 0.1277 0.314422 0.1766 0.488369 0.1279l4.500003 -1.26c0.08308 -0.0233 0.15873 -0.0677 0.21959 -0.1288l8.19768 -8.2377 0.0014 -0.00135c0.1399 -0.13917 0.251 -0.30459 0.3269 -0.48679 0.0762 -0.18278 0.1154 -0.37884 0.1154 -0.57686 0 -0.19802 -0.0392 -0.39408 -0.1154 -0.57687 -0.0759 -0.1822 -0.187 -0.34763 -0.3269 -0.48679l-0.0014 -0.00134L11.7859 0.448721c-0.1393 -0.14211 -0.3056 -0.255064 -0.4891 -0.332273 -0.1842 -0.0775016 -0.382 -0.117424562 -0.5818 -0.117424562Z"/>',
  },
  /** `IconEye`: the reveal eye of a PasswordField while the secret is hidden. */
  eye: {
    viewBox: "0 0 14 14",
    size: 16,
    body: '<g><path fill-rule="evenodd" d="M2.9327 3.49099C4.0559 2.68177 5.4556 2 7 2c1.54441 0 2.9441 0.68177 4.0673 1.49099 1.1273 0.81215 2.0197 1.78397 2.5599 2.4369l0.0045 0.00553c0.2413 0.3002 0.3683 0.68062 0.3683 1.06664 0 0.38601 -0.127 0.76644 -0.3683 1.06664l-0.0045 0.00553c-0.5402 0.65292 -1.4326 1.62475 -2.5599 2.43687 -1.1232 0.8092 -2.52289 1.491 -4.0673 1.491 -1.5444 0 -2.9441 -0.6818 -4.0673 -1.491C1.80544 9.69698 0.913028 8.72515 0.37279 8.07223L0.36828 8.0667C0.127025 7.7665 0 7.38607 0 7.00006c0 -0.38602 0.127025 -0.76644 0.36828 -1.06664l0.00451 -0.00553c0.540238 -0.65293 1.43265 -1.62475 2.55991 -2.4369ZM7 9.25c1.24264 0 2.25 -1.00736 2.25 -2.25S8.24264 4.75 7 4.75 4.75 5.75736 4.75 7 5.75736 9.25 7 9.25Z" clip-rule="evenodd"></path></g>',
  },
  /** `IconEyeOff`: the same eye once the secret shows, to hide it again. */
  eyeOff: {
    viewBox: "0.044 0.044 13.912 13.912",
    size: 16,
    body: '<g><path fill-rule="evenodd" d="M0.263638 1.32434c-0.2928929 -0.2929 -0.2928929 -0.767771 0 -1.060664 0.292894 -0.2928929 0.767772 -0.2928929 1.060662 0L3.95291 2.89228c0.90784 -0.49884 1.93998 -0.85203 3.04708 -0.85203 1.53199 0 2.92043 0.67629 4.03461 1.479 1.1182 0.80562 2.0034 1.76963 2.5393 2.41731l0.0045 0.00548c0.2393 0.29779 0.3653 0.67515 0.3653 1.05806s-0.126 0.76028 -0.3653 1.05806l-0.0045 0.00549c-0.4886 0.59054 -1.2677 1.44407 -2.2489 2.20075l2.4114 2.4113c0.2929 0.2929 0.2929 0.7678 0 1.0607 -0.2929 0.2929 -0.7678 0.2929 -1.0607 0L0.263638 1.32434ZM9.01713 7.95651c0.13771 -0.2899 0.21477 -0.61419 0.21477 -0.95649 0 -1.23264 -0.99926 -2.2319 -2.23191 -2.2319 -0.34229 0 -0.66659 0.07705 -0.95649 0.21476l2.97363 2.97363ZM0.426074 5.93656c0.319448 -0.38609 0.763036 -0.88458 1.306096 -1.39491l7.10402 7.10405c-0.58062 0.1961 -1.19587 0.3143 -1.8362 0.3143 -1.53198 0 -2.92042 -0.6763 -4.03459 -1.479C1.8472 9.67534 0.961967 8.71133 0.426074 8.06365L0.4216 8.05816C0.182285 7.76038 0.0562814 7.38301 0.0562814 7.0001S0.182285 6.23983 0.4216 5.94204l0.004474 -0.00548Z" clip-rule="evenodd"></path></g>',
  },
  /** `IconCopy`: a CopyField's button. */
  copy: {
    viewBox: "2 2 20 20",
    size: 16,
    body: '<path d="M20.926 7.074a3.67 3.67 0 0 1 1.074 2.593v8.666a3.667 3.667 0 0 1 -3.667 3.667h-8.666a3.667 3.667 0 0 1 -3.667 -3.667v-8.666q 0 -.053 .005 -.102a3.66 3.66 0 0 1 3.662 -3.565h8.666c.973 0 1.905 .386 2.593 1.074" /><path d="M17.374 3.514a1 1 0 1 1 -1.748 .972c-.221 -.398 -.342 -.486 -.626 -.486h-10c-.548 0 -1 .452 -1 1v9.998c0 .36 .194 .692 .507 .87a1 1 0 1 1 -.99 1.738a3 3 0 0 1 -1.517 -2.606v-10c0 -1.652 1.348 -3 3 -3h10c1.094 0 1.828 .533 2.374 1.514" />',
  },
  /** `IconFolderOpen`: a PathField's button. */
  folderOpen: {
    viewBox: "0 -31.981 575.963 575.963",
    size: 16,
    body: '<path d="M88.7 223.8L0 375.8 0 96C0 60.7 28.7 32 64 32l117.5 0c17 0 33.3 6.7 45.3 18.7l26.5 26.5c12 12 28.3 18.7 45.3 18.7L416 96c35.3 0 64 28.7 64 64l0 32-336 0c-22.8 0-43.8 12.1-55.3 31.8zm27.6 16.1C122.1 230 132.6 224 144 224l400 0c11.5 0 22 6.1 27.7 16.1s5.7 22.2-.1 32.1l-112 192C453.9 474 443.4 480 432 480L32 480c-11.5 0-22-6.1-27.7-16.1s-5.7-22.2 .1-32.1l112-192z"/>',
  },
  /** The small cross that dismisses a toast. */
  dismiss: {
    viewBox: "0 0 16 16",
    size: 14,
    body: '<rect x="6.8" y="2.5" width="2.4" height="11" rx="0.6" transform="rotate(45 8 8)"/><rect x="6.8" y="2.5" width="2.4" height="11" rx="0.6" transform="rotate(-45 8 8)"/>',
  },
} satisfies Record<string, Mark>;

// The toast's severity as filled shapes (design-language.md, "Icon glyphs"). The
// mark inside each is painted in the card's own surface colour so it reads as a
// cutout.
const CUTOUT = 'fill="var(--carbon-surface, transparent)"';
export const TOAST_MARKS = {
  success: {
    viewBox: "0 0 16 16",
    size: 16,
    body: `<circle cx="8" cy="8" r="6.4"/><rect x="4.5" y="8.4" width="3.5" height="1.5" rx="0.75" ${CUTOUT} transform="rotate(45 6.25 9.15)"/><rect x="5.815" y="7.25" width="6.27" height="1.5" rx="0.75" ${CUTOUT} transform="rotate(-50.2 8.95 8)"/>`,
  },
  warn: {
    viewBox: "0 0 16 16",
    size: 16,
    body: `<path d="M8 2.2 14.5 13.6H1.5L8 2.2Z"/><rect x="7.3" y="6.6" width="1.4" height="3" rx="0.7" ${CUTOUT}/><circle cx="8" cy="11.9" r="0.85" ${CUTOUT}/>`,
  },
  fail: {
    viewBox: "0 0 16 16",
    size: 16,
    body: `<circle cx="8" cy="8" r="6.4"/><rect x="7.3" y="4.6" width="1.4" height="4" rx="0.7" ${CUTOUT}/><circle cx="8" cy="10.9" r="0.85" ${CUTOUT}/>`,
  },
} satisfies Record<string, Mark>;

/** A mark as SVG markup, for a page that writes HTML. */
export function markSvg(mark: Mark): string {
  return `<svg width="${mark.size}" height="${mark.size}" viewBox="${mark.viewBox}" fill="currentColor" aria-hidden="true">${mark.body}</svg>`;
}
