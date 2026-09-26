import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, LayoutAnimation, Platform, UIManager } from "react-native";

import { confirmPeak, NATIVE_MOTION, springOf } from "./motionNative";
import { DEFAULT_APPEARANCE, useAppearance, type MotionIntensity } from "./settings";

/**
 * The motion levels of the web app's lib/motion.ts: one animation at every
 * level, with only the numbers changing. Android's reduce motion setting always
 * wins. LayoutAnimation covers most movement here, since nearly everything that
 * moves is a layout change.
 */

export type { MotionIntensity };

/** The levels the picker offers. A stored value may also be the hidden `storm`. */
export const MOTION_INTENSITIES: MotionIntensity[] = ["off", "subtle", "wild"];

/**
 * A fresh install starts at the middle level, GlimStone's default. A stored
 * appearance keeps the level it holds.
 */
export const DEFAULT_MOTION: MotionIntensity = DEFAULT_APPEARANCE.motion;

/** The numbers per level, from GlimStone's reference as it is. */
export const MOTION = NATIVE_MOTION;

export { springOf };

// Without this, LayoutAnimation is a no-op on the old architecture. The new
// architecture drops the method, so its absence is fine.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Whether Android's reduce motion setting is on; watched while the app runs. */
let systemReduced = false;
const listeners = new Set<() => void>();

AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => {
    systemReduced = on;
    listeners.forEach((fn) => fn());
  })
  .catch(() => {
    // No such setting on this Android; the app's own choice applies.
  });

AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
  systemReduced = on;
  listeners.forEach((fn) => fn());
});

/** The level in force: the app's own choice, or `off` when Android asks for less motion. */
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
 * Animates the next layout change. Call it before the state update, since
 * LayoutAnimation configures the next commit.
 */
export function animateNext(intensity: MotionIntensity, kind: "layout" | "fade" = "layout"): void {
  const duration = MOTION[intensity][kind];
  if (!duration) return;
  const spring = MOTION[intensity].spring;
  // Damping sets the overshoot: 0.6 is a visible bounce, 1.0 none.
  const damping = MOTION[intensity].damping;
  LayoutAnimation.configureNext({
    duration,
    create: spring
      ? { type: LayoutAnimation.Types.spring, property: LayoutAnimation.Properties.scaleXY, springDamping: damping }
      : { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: spring
      ? { type: LayoutAnimation.Types.spring, springDamping: damping }
      : { type: LayoutAnimation.Types.easeInEaseOut },
    delete: spring
      ? { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity }
      : { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

/**
 * The swell a control gives when what it did landed: a copy, an export or an
 * import. It grows to confirmPeak() over the first 40 per cent of `confirm`
 * and settles back over the rest, the web's `glim-confirm` without its ring,
 * since a phone control has no room around it for one. At `off` nothing moves.
 */
export function useConfirm(): { scale: Animated.Value; confirm: () => void } {
  const { ms } = useMotion();
  const scale = useRef(new Animated.Value(1)).current;
  // Read when the success lands, so a callback kept from an earlier render
  // still plays at the level in force.
  const level = useRef(ms);
  level.current = ms;
  const confirm = useCallback(() => {
    const m = level.current;
    if (!m.confirm || !m.confirmScale) return;
    scale.setValue(1);
    const leg = (toValue: number, duration: number) =>
      Animated.timing(scale, { toValue, duration, easing: Easing.out(Easing.ease), useNativeDriver: true });
    Animated.sequence([leg(confirmPeak(m), m.confirm * 0.4), leg(1, m.confirm * 0.6)]).start();
  }, [scale]);
  return { scale, confirm };
}
