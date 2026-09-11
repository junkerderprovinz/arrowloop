import { useEffect, useState } from "react";
import { AccessibilityInfo, LayoutAnimation, Platform, UIManager } from "react-native";

import { useAppearance, type MotionIntensity } from "./settings";

/**
 * The motion engine, as React Native.
 *
 * THE SAME THREE STATES the container has - `off`, `subtle`, `full` - and the
 * same rule behind them: one animation at every intensity, with only the
 * NUMBERS changing. "Subtle" is never a different animation from "full", it is
 * a smaller one. The container's own `lib/motion.ts` says why at length; this
 * is that engine with CSS custom properties swapped for a plain table, because
 * there is no stylesheet here to redefine.
 *
 * DEFAULT IS FULL. This axis is polish somebody dials DOWN rather than a
 * fallback they opt into, which is the opposite of the theme axis and for the
 * opposite reason.
 *
 * IT COMPOSES WITH ANDROID'S OWN SETTING and never overrides it. A phone whose
 * owner has asked the system for less motion gets the `off` numbers whatever
 * this app is set to - the web achieves that by living inside a
 * `prefers-reduced-motion: no-preference` block, and here it is a subscription
 * to `AccessibilityInfo`. Somebody who turned animations off system-wide did
 * not mean "except in this one app".
 *
 * WHY `LayoutAnimation` AND NOT `Animated`: almost everything that moves here
 * is a LAYOUT change - a row appearing, a card growing, a palette opening. For
 * those, one call before the state update animates the whole tree, where
 * `Animated` would need a driven value per element and a measured height for
 * anything that grows. Where a real driven animation is wanted, `Animated` is
 * still there; this is the common case, not the only one.
 */

export type { MotionIntensity };

export const MOTION_INTENSITIES: MotionIntensity[] = ["off", "subtle", "full"];

export const DEFAULT_MOTION: MotionIntensity = "full";

/**
 * The durations, in milliseconds, per intensity.
 *
 * The same numbers the container's tokens carry, so a phone and a browser side
 * by side move at the same speed. `off` is zero everywhere, which is what makes
 * the animation calls below safe to leave in place rather than branching around
 * them: a zero-duration layout animation is an instant layout change.
 */
export const MOTION: Record<MotionIntensity, { layout: number; fade: number; toast: number }> = {
  full: { layout: 280, fade: 110, toast: 220 },
  subtle: { layout: 140, fade: 70, toast: 120 },
  off: { layout: 0, fade: 0, toast: 0 },
};

// Android needs this switched on explicitly, and without it every
// LayoutAnimation call is silently a no-op - which is the worst of both worlds:
// the code reads as animated and the app does not move. It is deprecated on
// the new architecture, where layout animations work without it, so a missing
// method is not an error here.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Whether Android itself has been asked for less motion. Read once and then
 *  watched, because somebody can change it while the app is open. */
let systemReduced = false;
const listeners = new Set<() => void>();

AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => {
    systemReduced = on;
    listeners.forEach((fn) => fn());
  })
  .catch(() => {
    // An Android that cannot answer is an Android with no such setting, and
    // the app's own choice is then the whole answer.
  });

AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
  systemReduced = on;
  listeners.forEach((fn) => fn());
});

/**
 * The intensity in force: the app's own choice, or `off` where the system asked
 * for less motion.
 *
 * The system WINS rather than being merged with. A person who turned animations
 * off in Android's accessibility settings has made a decision about every app
 * on the phone, and an app that treated that as a suggestion would be arguing
 * with an accessibility setting.
 */
export function useMotion(): { intensity: MotionIntensity; ms: (typeof MOTION)[MotionIntensity] } {
  const a = useAppearance();
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const intensity: MotionIntensity = systemReduced ? "off" : a.motion;
  return { intensity, ms: MOTION[intensity] };
}

/**
 * Animate the next layout change, at the intensity in force.
 *
 * Called BEFORE the state update that changes the layout, which is how
 * LayoutAnimation works: it configures the next commit rather than animating
 * anything itself. A zero duration configures an instant one, so call sites
 * never have to ask whether motion is on.
 */
export function animateNext(intensity: MotionIntensity, kind: "layout" | "fade" = "layout"): void {
  const duration = MOTION[intensity][kind];
  if (!duration) return;
  LayoutAnimation.configureNext({
    duration,
    // Springs are the platform default and read as bouncy, which is not this
    // language's register: GlimStone's own curve is a firm ease-out, and
    // `easeInEaseOut` is the closest of the three React Native ships.
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}
