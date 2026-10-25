import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { Glyph, glyphParts, glyphSpan } from "./glyphs";
import { useT } from "./i18n";
import { useMotion, useSystemReduced, type MotionIntensity } from "./motion";
import { space } from "./theme";
import { Button, Caption, Choice, useTheme } from "./ui";

// The phone stacks a job's two sides, so "to the right" names nothing on it.
// The direction is drawn from the upper side to the lower one instead, with
// the web's sideways arrows turned a quarter.

export type Way = "both" | "leftToRight" | "rightToLeft";

/** Reads a stored direction. Older configurations spell it `toRight` or `right`. */
export function wayOf(direction: string | undefined): Way {
  if (direction === "leftToRight" || direction === "toRight" || direction === "right") {
    return "leftToRight";
  }
  if (direction === "rightToLeft" || direction === "toLeft" || direction === "left") {
    return "rightToLeft";
  }
  return "both";
}

const WAYS: Way[] = ["both", "leftToRight", "rightToLeft"];

/** The answer a tap on WayButton moves on to, in the order of WAYS. */
const NEXT: Record<Way, Way> = { both: "leftToRight", leftToRight: "rightToLeft", rightToLeft: "both" };

const GLYPHS: Record<Way, string> = {
  both: "IconBothWays",
  leftToRight: "IconToRight",
  rightToLeft: "IconToLeft",
};

/**
 * How long one arrow takes to travel and how far it goes, in grid units: the
 * web's --motion-flow-dur and --motion-flow-dist per level.
 */
const FLOW: Record<MotionIntensity, { ms: number; reach: number }> = {
  storm: { ms: 1200, reach: 3 },
  wild: { ms: 1800, reach: 2 },
  subtle: { ms: 2800, reach: 1.5 },
  off: { ms: 0, reach: 0 },
};

/**
 * The arrow between two stacked sides: down for left to right, up for the
 * other way. While the job runs (`flowing`) the arrows travel the way the
 * files go, each arrow on its own.
 */
export function WayGlyph({
  way,
  color,
  size = 18,
  flowing,
}: {
  way: Way;
  color: string;
  size?: number;
  flowing?: boolean;
}) {
  const { intensity } = useMotion();
  // A loop that never ends stops for a phone that asks for less motion, the
  // storm included, as the web's does.
  const reduced = useSystemReduced();
  const flow = FLOW[intensity];
  return (
    <View style={styles.turned}>
      {flowing && !reduced && flow.ms ? (
        <Flow way={way} color={color} size={size} ms={flow.ms} reach={flow.reach} />
      ) : (
        <Glyph name={GLYPHS[way]} color={color} size={size} />
      )}
    </View>
  );
}

/**
 * The arrows of a direction mark travelling one way and fading at both ends
 * of their run, so the jump back to the start never shows. Both ways sends
 * its two arrows in opposite directions, half a beat apart.
 */
function Flow({
  way,
  color,
  size,
  ms,
  reach,
}: {
  way: Way;
  color: string;
  size: number;
  ms: number;
  reach: number;
}) {
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    beat.setValue(0);
    const loop = Animated.loop(
      Animated.timing(beat, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [beat, ms]);

  const name = GLYPHS[way];
  const far = (reach * size) / glyphSpan(name);
  return (
    <View style={{ width: size, height: size }}>
      {Array.from({ length: glyphParts(name) }, (_, part) => {
        const back = way === "rightToLeft" || (way === "both" && part === 1);
        const late = way === "both" && part === 1;
        const sign = back ? -1 : 1;
        const translateX = late
          ? beat.interpolate({ inputRange: [0, 0.4999, 0.5, 1], outputRange: [0, far * sign, -far * sign, 0] })
          : beat.interpolate({ inputRange: [0, 1], outputRange: [-far * sign, far * sign] });
        const opacity = late
          ? beat.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 1, 0, 1, 1] })
          : beat.interpolate({ inputRange: [0, 0.25, 0.75, 1], outputRange: [0, 1, 1, 0] });
        return (
          <Animated.View key={part} style={[StyleSheet.absoluteFill, { opacity, transform: [{ translateX }] }]}>
            <Glyph name={name} color={color} size={size} part={part} />
          </Animated.View>
        );
      })}
    </View>
  );
}

/** What a screen reader says for a direction between two named sides. */
export function wayLabel(way: Way, upper: string, lower: string, both: string): string {
  if (way === "both") return both;
  return way === "leftToRight" ? `${upper} → ${lower}` : `${lower} → ${upper}`;
}

/**
 * The direction between two stacked sides: three arrows, and under them a line
 * naming the side files come from and the side they go to.
 */
export function WaySwitch({
  value,
  onChange,
  disabled,
  upper,
  lower,
}: {
  value: string | undefined;
  onChange: (next: Way) => void;
  disabled?: boolean;
  /** The names of the two sides, in the order they stand on the page. */
  upper: string;
  lower: string;
}) {
  const { t, rtl } = useT();
  const { p } = useTheme();
  const way = wayOf(value);
  const [from, to] = way === "rightToLeft" ? [lower, upper] : [upper, lower];
  return (
    <View style={styles.stack}>
      <Choice<Way>
        hue={0}
        value={way}
        disabled={disabled}
        onChange={onChange}
        options={WAYS.map((each) => ({
          value: each,
          label: wayLabel(each, upper, lower, t("direction.both")),
          mark: (ink) => <WayGlyph way={each} color={ink} />,
        }))}
      />
      {/* A row runs from the right in a right-to-left language, so the arrow
          between the two names turns with it. The line stays at full strength
          under a dimmed switch, since it is the only words for the direction. */}
      <View style={styles.line}>
        <Caption>{from}</Caption>
        <Glyph
          name={way === "both" ? "IconBothWays" : rtl ? "IconToLeft" : "IconToRight"}
          color={p.textMuted}
          size={14}
        />
        <Caption>{to}</Caption>
      </View>
    </View>
  );
}

/**
 * The direction between a job's two side cards as one button, the web's
 * DirectionSwitch: its arrow points the way files go and a tap moves on to
 * the next of the three answers.
 */
export function WayButton({
  value,
  onChange,
  upper,
  lower,
}: {
  value: string | undefined;
  onChange: (next: Way) => void;
  upper: string;
  lower: string;
}) {
  const { t } = useT();
  const way = wayOf(value);
  const name = wayLabel(way, upper, lower, t("direction.both"));
  return (
    <View style={styles.way}>
      <Button
        label={name}
        tone="accent"
        hue={0}
        wide={false}
        hint={t("direction.hint")}
        mark={(ink) => <WayGlyph way={way} color={ink} />}
        onPress={() => onChange(NEXT[way])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  turned: { transform: [{ rotate: "90deg" }] },
  way: { flexDirection: "row", justifyContent: "center" },
  stack: { gap: space.xs },
  line: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
  },
});
