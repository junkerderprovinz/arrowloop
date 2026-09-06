// Copied verbatim from GlimStone 1.7.2, reference/tooltip.ts.
// Do not edit here: change it in the design language repo and copy again.
// https://github.com/junkerderprovinz/glimstone
// The tooltip/info-bubble engine (design-language.md, "The tooltip and info
// bubble"). ONE floating bubble, positioned from the trigger's own bounding
// box, shared by every hover tooltip AND every "(i)" info icon in the app -
// not two separate implementations. Extracted from CannonadeCommand's own
// #cc-tipfloat mechanism, the reference an adopting app should match
// pixel-for-pixel rather than build its own variant of.
//
// Framework-free, like appearance.ts/selectScroll.ts: talks only to
// document.body and the trigger elements it's given.

const BUBBLE_ID = 'glim-bubble';
let currentTrigger: Element | null = null;

function bubbleEl(): HTMLDivElement {
  let el = document.getElementById(BUBBLE_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = BUBBLE_ID;
    // `glim-fade` (cross-app info-bubble standardisation) - a 110ms
    // opacity fade on open, matching design-language.md's motion-engine
    // section (it always claimed the info bubble gets 110ms flat; this
    // shared engine just never actually applied the class before). The
    // browser restarts a CSS animation on an element that re-enters
    // rendering after `display: none`, so toggling `el.style.display`
    // below is enough to replay the fade every time - no need to
    // remove/re-add the class per show().
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
  // Shown before measuring - offsetWidth/Height only resolve while the
  // element is actually laid out (display !== 'none').
  el.style.display = 'block';
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const cx = rect.left + rect.width / 2;
  // Clamped into the viewport, not just centred on the trigger - a trigger
  // near either edge (a toolbar's outermost icon, a table's last column)
  // would otherwise push the bubble half off-screen.
  const x = Math.max(8 + w / 2, Math.min(vw - 8 - w / 2, cx));
  el.style.left = `${x}px`;
  // Flips ABOVE the trigger when opening below would clip the viewport's
  // bottom edge, but only if there's actually room up there - a trigger
  // pinned to the very top of the page keeps opening downward regardless.
  const above = rect.bottom + 8 + h > vh && rect.top - 8 - h >= 0;
  el.classList.toggle('glim-bubble--above', above);
  el.style.top = `${above ? rect.top - 8 - h : rect.bottom + 8}px`;
  // The arrow tracks the trigger's real centre even when the bubble itself
  // has been clamped off-centre near a viewport edge - without this, a
  // clamped bubble's arrow would point at empty space instead of the trigger.
  el.style.setProperty('--glim-tip-ax', `${Math.max(10, Math.min(w - 10, cx - (x - w / 2)))}px`);
}

let wired = false;

/**
 * Wires the shared delegated listeners once for the whole document. Any
 * element carrying `data-tip` shows the bubble on hover or focus; a stray
 * native `title` is auto-upgraded to `data-tip` on its first hover (and the
 * native attribute removed, so the browser's own tooltip never also fires) -
 * this means adopting the engine doesn't require hunting down and rewriting
 * every existing `title=` in the app, only calling this once at boot.
 * Idempotent - safe to call more than once.
 */
export function wireTooltips(): void {
  if (wired) return;
  wired = true;

  function over(event: Event): void {
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
  // A press means the person is acting, not reading - hide immediately.
  document.addEventListener('pointerdown', hide, true);
  // Any scroll de-anchors the fixed-position bubble from its trigger -
  // capture so an inner scrollable container's scroll is caught too, not
  // just the window's own.
  window.addEventListener('scroll', hide, true);
  // Escape closes it WITHOUT moving focus away from the trigger (cross-app
  // info-bubble standardisation) - a keyboard user reading a tip covering
  // nearby content can dismiss it and keep working from the same control,
  // rather than having to tab away just to make it go away. This was
  // missing entirely before: the only way to close via keyboard was to
  // blur the trigger.
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && currentTrigger) hide();
  });
}

/**
 * The "(i)" info-icon trigger (rule 8) - rides the SAME shared bubble as
 * every other tooltip, not a separate implementation. `text` is both the
 * bubble's content and the icon's accessible name; update `data-tip` and
 * `aria-label` together (e.g. on a locale switch) to change what it shows.
 */
export function infoIcon(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'glim-info-icon';
  // Glyph corrected to the real production markup (cross-app info-bubble
  // standardisation, BombVault as the reference implementation): outer
  // ring r7.1/stroke-width1.2 -> r7/1.3, dot r1.05 at cy4.7 -> r0.9 at
  // cy4.6, and the stem changed from a FILLED rounded rect
  // (x7.05 y6.8 width1.9 height5 rx.95) to a round-capped STROKED path
  // (`M8 7v4.4`, stroke-width 1.3) - same three-piece "i" (ring, dot,
  // stem), same currentColor-only look, just the exact numbers a real
  // adopting app ships rather than an approximation of them.
  span.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="4.6" r="0.9" fill="currentColor"/><path d="M8 7v4.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  span.setAttribute('data-tip', text);
  span.setAttribute('aria-label', text);
  span.tabIndex = 0;
  return span;
}
