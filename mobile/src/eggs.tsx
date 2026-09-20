import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { Glyph } from "./glyphs";
import { setAppearance, useAppearance } from "./settings";
import { RAINBOW } from "./theme";

// The easter eggs, kept together so none is lost to a tidy-up. They never
// change what a sync does, never decide whether a guard refuses (only how it
// words the refusal), are never random, and never hide an error or a figure.

/** Taps on the About card's title that start the loop. */
const TAPS = 7;

const LOOP_MS = 2600;

/** Arrows on the ring. */
const ARROWS = 8;

/** The ring's radius in points. */
const RADIUS = 78;

/**
 * Seven taps on the About card's title spin a ring of arrows through the
 * accent wheel. The title carries no other action, unlike the version line's
 * links, which take the tap first. Nothing is stored, and the animation
 * ignores the motion setting, since the animation is what the gesture asks for.
 * The colour is React state since an animated colour does not reach an SVG.
 */
export function useClosingLoop(): { tap: () => void; mark: ReactNode } {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const taps = useRef(0);
  const turn = useRef(new Animated.Value(0)).current;

  // Ends on the colour it began with.
  const wheel: string[] = [...RAINBOW, RAINBOW[0] ?? "#FCC419"];

  useEffect(() => {
    if (!running) return;
    turn.setValue(0);
    const spin = Animated.timing(turn, {
      toValue: 1,
      duration: LOOP_MS,
      // A linear turn would read as a loading spinner.
      easing: Easing.inOut(Easing.cubic),
      // Only transforms and opacity, so it can run on the native driver.
      useNativeDriver: true,
    });
    spin.start();
    const every = Math.max(1, Math.round(LOOP_MS / wheel.length));
    let at = 0;
    const tick = setInterval(() => {
      at += 1;
      setStep(at);
      if (at >= wheel.length - 1) {
        clearInterval(tick);
        setRunning(false);
      }
    }, every);
    return () => {
      spin.stop();
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, turn]);

  // Three full turns, growing out of the middle past full size and shrinking
  // back into it.
  const spin = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "1080deg"] });
  const scale = turn.interpolate({ inputRange: [0, 0.25, 0.75, 1], outputRange: [0.2, 1.12, 1, 0.2] });
  const fade = turn.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, 1, 1, 0] });
  const colour = wheel[step] ?? wheel[0] ?? "#FCC419";

  return {
    tap: () => {
      taps.current += 1;
      if (taps.current < TAPS) return;
      taps.current = 0;
      setStep(0);
      setRunning(true);
    },
    mark: running ? (
      <View pointerEvents="none" style={styles.stage}>
        <Animated.View style={[styles.ring, { opacity: fade, transform: [{ rotate: spin }, { scale }] }]}>
          {Array.from({ length: ARROWS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.spoke,
                // Turned to its angle, then pushed out along it.
                { transform: [{ rotate: `${(360 / ARROWS) * i}deg` }, { translateY: -RADIUS }] },
              ]}
            >
              <Glyph name="IconToRight" color={colour} size={26} />
            </View>
          ))}
        </Animated.View>
      </View>
    ) : null,
  };
}

/** Further taps on an already chosen "wild" that unlock the storm level. */
const STORM_TAPS = 5;

/**
 * Unlocks the hidden `storm` motion level after five more taps on an already
 * chosen "wild". The level stays on offer while it is chosen, and otherwise
 * only while the calling screen stays mounted.
 */
export function useStormUnlock(): { offered: boolean; tap: (level: string) => void } {
  const look = useAppearance();
  const [found, setFound] = useState(false);
  const taps = useRef(0);
  return {
    offered: found || look.motion === "storm",
    tap: (level: string) => {
      if (level !== "wild" || look.motion !== "wild") {
        taps.current = 0;
        return;
      }
      taps.current += 1;
      if (taps.current < STORM_TAPS) return;
      taps.current = 0;
      setFound(true);
      void setAppearance({ motion: "storm" });
    },
  };
}

/**
 * Reports whether an idle run gets the alternative wording: every fiftieth
 * run by id, so the same run always reads the same.
 */
export function isPerfectlyIdle(runId: number, unchanged: number): boolean {
  return unchanged > 0 && runId > 0 && runId % 50 === 0;
}

const styles = StyleSheet.create({
  // Laid over the card, so its text does not move.
  stage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  ring: { width: RADIUS * 2, height: RADIUS * 2, alignItems: "center", justifyContent: "center" },
  spoke: { position: "absolute" },
});
