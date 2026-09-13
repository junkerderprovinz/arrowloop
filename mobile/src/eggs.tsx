import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";

import { Glyph } from "./glyphs";
import { setAppearance, useAppearance } from "./settings";
import { RAINBOW } from "./theme";

/**
 * The easter eggs, all of them, in one place.
 *
 * ONE MODULE ON PURPOSE. Four small secrets scattered across four screens are
 * four things nobody remembers are there, and the first person to tidy one of
 * those screens deletes one without knowing what it was. Here they are a named
 * category with the rules written down, which is also how they are kept in the
 * design language (`[[GlimStone]]`, section "Easter Eggs").
 *
 * THE RULES THEY ALL FOLLOW, and they are the whole reason this file can exist
 * in a program that moves people's files:
 *
 * 1. **Nothing an egg does may lose data or change what a sync does.** Three of
 *    the four are pure display. The fourth adds a real setting, and it is one
 *    that can be turned straight back down.
 * 2. **A guard stays a guard.** The Ouroboros egg lives in the WORDING of a
 *    refusal, never in whether the refusal happens - the engine refuses the job
 *    either way, and the joke is only what it says while doing it.
 * 3. **No randomness.** A secret that appears at random cannot be shown to
 *    somebody else, which is most of the point of finding one. Every egg here
 *    is a repeatable gesture or a stated arithmetic.
 * 4. **Nothing hides a fault.** No egg replaces an error, a warning or a
 *    figure somebody needs.
 */

/** How many taps on the version line open the loop. */
const TAPS = 7;

/** How long the loop takes to come round, in milliseconds. */
const LOOP_MS = 1800;

/**
 * The arrow closes the loop.
 *
 * Tap the version line seven times and the app's own mark turns once, all the
 * way round, while the line travels through the whole accent wheel and comes
 * back to the colour it started in. The app is called ArrowLoop and has never
 * once drawn a loop; this is the name taken literally for two seconds.
 *
 * PURELY LOCAL. The colour is interpolated in this component and nothing is
 * written to the stored appearance, so the accent somebody chose is exactly the
 * accent they still have when it stops. An egg that left the app a different
 * colour would be a bug people report rather than a secret they enjoy.
 *
 * It ignores the motion setting deliberately, and it is the only thing here
 * that does: this is not an interface animation that somebody might want out of
 * the way, it is the whole content of the gesture. Somebody who taps seven
 * times has asked for it.
 */
export function ClosingLoop({ children }: { children: ReactNode }) {
  const [taps, setTaps] = useState(0);
  const [running, setRunning] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!running) return;
    turn.setValue(0);
    const run = Animated.timing(turn, {
      toValue: 1,
      duration: LOOP_MS,
      easing: Easing.inOut(Easing.cubic),
      // The rotation could run on the native side; the colour cannot, and one
      // driver for both keeps the two halves of one gesture in step.
      useNativeDriver: false,
    });
    run.start(({ finished }) => {
      if (finished) setRunning(false);
    });
    return () => run.stop();
  }, [running, turn]);

  // Round the whole wheel and back to the start, so the line ends on the colour
  // it began on whatever the accent happens to be. The fallback is the house
  // yellow, and it exists only so that an empty palette cannot end a gesture in
  // a crash - a wheel of one colour is a dull secret, not a broken app.
  const wheel: string[] = [...RAINBOW, RAINBOW[0] ?? "#FCC419"];
  const colour = turn.interpolate({
    inputRange: wheel.map((_, i) => i / (wheel.length - 1)),
    outputRange: wheel,
  });
  const spin = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Pressable
      onPress={() => {
        const next = taps + 1;
        if (next >= TAPS) {
          setTaps(0);
          setRunning(true);
          return;
        }
        setTaps(next);
      }}
      // The line underneath is a link to the release notes, and a tap has to
      // keep doing that. Counting happens beside it rather than instead of it,
      // so six taps leave no trace and the seventh adds something.
      style={styles.row}
    >
      <Animated.View style={running ? { transform: [{ rotate: spin }] } : styles.hidden}>
        <Glyph name="IconBothWays" color={colour as unknown as string} size={16} />
      </Animated.View>
      <View style={styles.line}>{children}</View>
    </Pressable>
  );
}

/** How many taps on the chosen level open the one below the floor. */
const STORM_TAPS = 5;

/**
 * The storm: a fourth motion level, for somebody who thought the third was too
 * quiet.
 *
 * Set the motion to "wild", then tap that same word five more times. It is the
 * gesture of somebody pressing a button that is already pressed because they
 * wanted more of it, which is exactly who this is for - and it is how this egg
 * was asked for: jdp, looking at the app, "Hast du animationen in der app
 * eingebaut? Auch wilde? mir kommt es vor als würde ich keine sehen."
 *
 * IT CHANGES A SETTING, which makes it the one egg here that does anything
 * lasting, and that is why it is a setting rather than a mode: once found, the
 * fourth option simply stands in the picker beside the other three and can be
 * turned down again like any of them. A secret somebody cannot switch off is a
 * fault.
 *
 * Returns the tap handler, and the caller decides what wearing it means.
 */
export function useStormUnlock(): (level: string) => void {
  const look = useAppearance();
  const taps = useRef(0);
  return (level: string) => {
    // Only counts while the top VISIBLE level is the one already chosen. Tapping
    // "off" five times means somebody is annoyed, not curious.
    if (level !== "full" || look.motion !== "full" || look.storm) {
      taps.current = 0;
      return;
    }
    taps.current += 1;
    if (taps.current < STORM_TAPS) return;
    taps.current = 0;
    void setAppearance({ storm: true, motion: "storm" });
  };
}

/**
 * A run that did nothing, once in every fifty.
 *
 * Both sides already the same is the most ordinary outcome there is, and the
 * line reporting it counts the files that did not need to move. Every fiftieth
 * such run says something else instead.
 *
 * FROM THE RUN'S OWN NUMBER and not from a random draw, so the same run says the
 * same thing every time it is looked at, and so it can be shown to somebody.
 * The run log's identity is a counter, so one run in fifty is exactly what this
 * is.
 */
export function isPerfectlyIdle(runId: number, unchanged: number): boolean {
  return unchanged > 0 && runId > 0 && runId % 50 === 0;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Out of the layout entirely until it turns, so the version line sits where
  // it always sat and nothing shifts when the secret is found.
  hidden: { width: 0, height: 0, opacity: 0 },
  line: { flexShrink: 1 },
});
