import { useEffect, useState } from "react";
import { AccessibilityInfo, LayoutAnimation, Platform, UIManager } from "react-native";

import { useAppearance, type MotionIntensity } from "./settings";

/**
 * The motion levels of the web app's lib/motion.ts as a plain table: one
 * animation at every level, with only the numbers changing. Android's reduce
 * motion setting always wins. LayoutAnimation covers most movement here, since
 * nearly everything that moves is a layout change.
 */

export type { MotionIntensity };

/** The levels the picker offers. A stored value may also be the hidden `storm`. */
export const MOTION_INTENSITIES: MotionIntensity[] = ["off", "subtle", "wild"];

export const DEFAULT_MOTION: MotionIntensity = "wild";

/**
 * Durations in milliseconds per level, the same as the web app's tokens. A
 * zero duration is an instant layout change, so callers need no branch for
 * `off`.
 */
export const MOTION: Record<
  MotionIntensity,
  {
    layout: number;
    fade: number;
    toast: number;
    spring: boolean;
    damping: number;
    /** How far a card travels up into place as a page arrives, in points. */
    travel: number;
    /** How far it swings in from the side as well, alternating per card. */
    sway: number;
    /** The delay between one card's arrival and the next one's, in ms. */
    stagger: number;
    /** The scale a pressed button or card gives way to. */
    press: number;
    /** The damping ratio of the arrival and the press: below 1 overshoots. */
    bounce: number;
  }
> = {
  // Hidden behind a gesture in eggs.tsx.
  storm: {
    layout: 760, fade: 200, toast: 420, spring: true, damping: 0.34,
    travel: 72, sway: 48, stagger: 85, press: 0.84, bounce: 0.3,
  },
  // The top two spring and overshoot; the lower levels ease. The top one is
  // picked for its energy, so the cards fly in from both sides and bounce.
  wild: {
    layout: 420, fade: 140, toast: 300, spring: true, damping: 0.68,
    travel: 44, sway: 28, stagger: 65, press: 0.9, bounce: 0.42,
  },
  subtle: {
    layout: 140, fade: 70, toast: 120, spring: false, damping: 1,
    travel: 10, sway: 0, stagger: 25, press: 0.97, bounce: 1,
  },
  off: {
    layout: 0, fade: 0, toast: 0, spring: false, damping: 1,
    travel: 0, sway: 0, stagger: 0, press: 1, bounce: 1,
  },
};

/**
 * A spring for Animated from a damping ratio, which reads the same at any
 * stiffness where React Native's own `damping` does not.
 */
export function springOf(ratio: number): { stiffness: number; damping: number; mass: number } {
  const stiffness = 180;
  return { stiffness, damping: ratio * 2 * Math.sqrt(stiffness), mass: 1 };
}

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
