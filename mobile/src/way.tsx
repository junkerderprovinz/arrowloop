import { StyleSheet, View } from "react-native";
import { Glyph } from "./glyphs";
import { useT } from "./i18n";
import { space } from "./theme";
import { Caption, Choice, useTheme } from "./ui";

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

const GLYPHS: Record<Way, string> = {
  both: "IconBothWays",
  leftToRight: "IconToRight",
  rightToLeft: "IconToLeft",
};

/** The arrow between two stacked sides: down for left to right, up for the other way. */
export function WayGlyph({ way, color, size = 18 }: { way: Way; color: string; size?: number }) {
  return (
    <View style={styles.turned}>
      <Glyph name={GLYPHS[way]} color={color} size={size} />
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

const styles = StyleSheet.create({
  turned: { transform: [{ rotate: "90deg" }] },
  stack: { gap: space.xs },
  line: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
  },
});
