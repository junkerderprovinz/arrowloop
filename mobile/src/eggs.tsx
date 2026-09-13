import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing } from "react-native";

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

/** How many taps on the About card's own name open the loop. */
const TAPS = 7;

/** How long the loop takes to come round, in milliseconds. */
const LOOP_MS = 1800;

/**
 * The arrow closes the loop.
 *
 * Tap the card's own name seven times and the app's mark turns once, all the
 * way round, travelling through the whole accent wheel and landing back where
 * it started. The app is called ArrowLoop and has never once drawn a loop; this
 * is the name taken literally for two seconds.
 *
 * THE TITLE AND NOT THE VERSION LINE, and that was found on the device rather
 * than reasoned out. The version line is two LINKS, and in React Native an
 * inner `Text` with its own `onPress` takes the tap before any wrapper sees it
 * - so the gesture worked only in the empty space beside the words, and
 * following the instructions as written opened a browser seven times. A card's
 * name is the one part of a card that carries no other action.
 *
 * PURELY LOCAL. Nothing is written to the stored appearance, so the accent
 * somebody chose is exactly the accent they still have when it stops.
 *
 * THE COLOUR IS STATE AND THE TURN IS ANIMATED, which is not a style choice.
 * An `Animated` colour reaches a `View` fine and does NOT reach an SVG: the
 * first build handed an interpolation to the glyph's `color`, and on the device
 * the mark took up its space and drew nothing at all. Twelve state changes over
 * two seconds cost nothing and are a colour every renderer understands.
 *
 * It ignores the motion setting deliberately, and it is the only thing here
 * that does: this is not an interface animation somebody might want out of the
 * way, it is the whole content of the gesture. Seven taps is asking for it.
 */
export function useClosingLoop(): { tap: () => void; mark: ReactNode } {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const taps = useRef(0);
  const turn = useRef(new Animated.Value(0)).current;

  // Round the whole wheel and back to the start, so the mark ends on the colour
  // it began on. The fallback is the house yellow and exists only so an empty
  // palette cannot end a gesture in a crash.
  const wheel: string[] = [...RAINBOW, RAINBOW[0] ?? "#FCC419"];

  useEffect(() => {
    if (!running) return;
    turn.setValue(0);
    const spin = Animated.timing(turn, {
      toValue: 1,
      duration: LOOP_MS,
      easing: Easing.inOut(Easing.cubic),
      // The rotation is a transform, so this one CAN go to the native side.
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

  const spin = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return {
    tap: () => {
      taps.current += 1;
      if (taps.current < TAPS) return;
      taps.current = 0;
      setStep(0);
      setRunning(true);
    },
    // Out of the layout entirely until it turns, so nothing on the card moves
    // until the secret is found.
    mark: running ? (
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <Glyph name="IconBothWays" color={wheel[step] ?? wheel[0] ?? "#FCC419"} size={18} />
      </Animated.View>
    ) : null,
  };
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
