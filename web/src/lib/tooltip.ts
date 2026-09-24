// The tooltip and info bubble (design-language.md, "The tooltip and info
// bubble"): one floating bubble, placed from the trigger's bounding box, shared
// by every hover tooltip and every "(i)" info icon.

const BUBBLE_ID = 'glim-bubble';
let currentTrigger: Element | null = null;
// Whether the last input was a pointer rather than a key. Focus that follows a
// press is a side effect (the click itself, or a dialog handing focus back to
// its opener), so it must not open the bubble; see react/useTipBubble.tsx.
let pointerWasLast = false;

function bubbleEl(): HTMLDivElement {
  let el = document.getElementById(BUBBLE_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = BUBBLE_ID;
    // An animation restarts when an element leaves `display: none`, so
    // toggling display replays the fade on every show.
    el.className = 'glim-bubble glim-fade';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

function hide(): void {
  const el = document.getElementById(BUBBLE_ID);
  if (el) el.style.display = 'none';
  currentTrigger = null;
}

function show(trigger: Element): void {
  const tip = trigger.getAttribute('data-tip');
  if (!tip) return;
  const el = bubbleEl();
  const rect = trigger.getBoundingClientRect();
  el.textContent = tip;
  // Shown before measuring, since offsetWidth and offsetHeight need layout.
  el.style.display = 'block';
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const cx = rect.left + rect.width / 2;
  const x = Math.max(8 + w / 2, Math.min(vw - 8 - w / 2, cx));
  el.style.left = `${x}px`;
  // Opens above when below would clip and there is room above; a trigger at
  // the very top keeps opening downward.
  const above = rect.bottom + 8 + h > vh && rect.top - 8 - h >= 0;
  el.classList.toggle('glim-bubble--above', above);
  el.style.top = `${above ? rect.top - 8 - h : rect.bottom + 8}px`;
  // The arrow points at the trigger's centre even when the bubble is clamped.
  el.style.setProperty('--glim-tip-ax', `${Math.max(10, Math.min(w - 10, cx - (x - w / 2)))}px`);
}

let wired = false;

/**
 * Wires the delegated listeners once for the whole document; later calls do
 * nothing. An element with `data-tip` shows the bubble on hover or focus, and a
 * native `title` is moved to `data-tip` on its first hover, so an app only has
 * to call this at boot.
 */
export function wireTooltips(): void {
  if (wired) return;
  wired = true;

  function over(event: Event): void {
    if (event.type === 'focusin' && pointerWasLast) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('[data-tip], [title]');
    if (!trigger) return;
    if (!trigger.getAttribute('data-tip')) {
      const nativeTitle = trigger.getAttribute('title');
      if (nativeTitle && nativeTitle.trim()) {
        trigger.setAttribute('data-tip', nativeTitle);
        trigger.removeAttribute('title');
      } else {
        return;
      }
    }
    if (trigger === currentTrigger) return;
    currentTrigger = trigger;
    show(trigger);
  }

  function out(event: Event): void {
    if (!currentTrigger) return;
    const to = (event as MouseEvent | FocusEvent).relatedTarget;
    if (to instanceof Node && currentTrigger.contains(to)) return;
    hide();
  }

  document.addEventListener('mouseover', over);
  document.addEventListener('mouseout', out);
  document.addEventListener('focusin', over);
  document.addEventListener('focusout', out);
  // A press means the person is acting, not reading.
  document.addEventListener(
    'pointerdown',
    () => {
      pointerWasLast = true;
      hide();
    },
    true,
  );
  document.addEventListener('keydown', () => (pointerWasLast = false), true);
  // Any scroll leaves the fixed bubble behind; capture catches inner scroll
  // containers too.
  window.addEventListener('scroll', hide, true);
  // Escape closes the bubble without moving focus off the trigger.
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && currentTrigger) hide();
  });
}

/**
 * The "(i)" info icon (rule 8), using the same bubble as every tooltip. `text`
 * is both the bubble's content and the icon's accessible name; update
 * `data-tip` and `aria-label` together, for example on a locale switch.
 */
export function infoIcon(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'glim-info-icon';
  // The same drawing as the React InfoBubble.
  span.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="4.6" r="0.9" fill="currentColor"/><path d="M8 7v4.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  span.setAttribute('data-tip', text);
  span.setAttribute('aria-label', text);
  span.tabIndex = 0;
  return span;
}
