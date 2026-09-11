import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { contrastOn, palettes, RAINBOW, radiusFor, space, text, TOUCH, type Palette } from "./theme";
import { useAppearance, type LabelMode } from "./settings";

/**
 * The pieces every screen is built from.
 *
 * Small on purpose. GlimStone on the web is a large component library because
 * the desktop interface is large; a phone shows one thing at a time, and a
 * handful of primitives covers it. Anything that turns up in three screens
 * belongs here, anything used once belongs in the screen that uses it.
 */

export interface Theme {
  p: Palette;
  radius: { control: number; card: number; pill: number };
  labels: LabelMode;
  rainbow: boolean;
  rainbowReactive: boolean;
  scheme: "dark" | "light";
}

/**
 * Everything a control needs to draw itself, in one hook.
 *
 * The accent OVERRIDES the palette's own, and its contrast is computed rather
 * than configured - a light accent with white text on it is unreadable, and
 * asking somebody to pick a second colour to fix the first one is not a
 * setting, it is a trap. Same rule the web side states in applyAccent.
 */
export function useTheme(): Theme {
  const system = useColorScheme() === "light" ? "light" : "dark";
  const a = useAppearance();
  const scheme = a.theme === "system" ? system : a.theme;
  const base = palettes[scheme];
  return {
    scheme,
    p: { ...base, accent: a.accent, accentContrast: contrastOn(a.accent) },
    radius: radiusFor(a.shape),
    labels: a.labels,
    rainbow: a.rainbow,
    rainbowReactive: a.rainbowReactive,
  };
}

/** Kept for the many call sites that only want colours. */
export function usePalette(): Palette {
  return useTheme().p;
}

/**
 * The colour one row in a list gets, by position.
 *
 * Rainbow mode makes a list scannable by colour rather than by reading it, and
 * the colour is handed out by POSITION so the same job is the same colour every
 * time the screen is opened. Off, everything is the accent - which is what the
 * app looks like unless somebody has asked for more.
 */
export function useHue(index: number): string {
  const { p, rainbow } = useTheme();
  if (!rainbow) return p.accent;
  return RAINBOW[index % RAINBOW.length]!;
}

export function Screen({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <View style={[styles.screen, { backgroundColor: p.background }]}>{children}</View>;
}

export function Card({
  children,
  onPress,
  style,
  hue,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Rainbow mode paints a card's left edge, which is what makes a list
   *  scannable without reading it. */
  hue?: string;
}) {
  const { p, radius, rainbow } = useTheme();
  const body = (
    <View
      style={[
        styles.card,
        { backgroundColor: p.surface, borderColor: p.border, borderRadius: radius.card },
        rainbow && hue ? { borderLeftColor: hue, borderLeftWidth: 3 } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  // `android_ripple` rather than an opacity change, because a ripple is what
  // every other app on the phone does and the difference is felt rather than
  // seen. This is the one place the mobile build deliberately does NOT copy
  // the web's hover ramp - there is no pointer to hover.
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: p.hover }}
      style={{ borderRadius: radius.card }}
    >
      {body}
    </Pressable>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.heading, { color: p.text }]}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.title, { color: p.text }]}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const { p } = useTheme();
  return <Text style={[styles.body, { color: muted ? p.textMuted : p.textSub }]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.caption, { color: p.textMuted }]}>{children}</Text>;
}

export function Mono({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return <Text style={[styles.mono, { color: p.textSub }]}>{children}</Text>;
}

export type Tone = "accent" | "neutral" | "ok" | "fail" | "warn";

export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const { p, radius } = useTheme();
  const ink = { accent: p.accent, neutral: p.textMuted, ok: p.ok, fail: p.fail, warn: p.warn }[tone];
  return (
    <View style={[styles.badge, { borderColor: ink, borderRadius: radius.pill }]}>
      <Text style={[styles.badgeText, { color: ink }]}>{label}</Text>
    </View>
  );
}

/**
 * A button, and it answers the LABEL ENGINE like every control in this house.
 *
 * `text` shows the word, `textGlyph` the word and the symbol, `glyph` the
 * symbol alone, `reactive` the symbol until it is pressed. The one difference
 * from the web: `reactive` resolves to the symbol alone here rather than
 * revealing on hover, because a phone has no hover - a label that appears
 * under a pointer is a label nobody on a phone will ever see.
 *
 * A button with NO glyph keeps its word in every mode. The alternative is an
 * empty box somebody has to press to identify, which is the same rule the
 * provider tiles follow on the web.
 */
export function Button({
  label,
  glyph,
  onPress,
  tone = "neutral",
  busy,
  disabled,
  wide,
}: {
  label: string;
  glyph?: string;
  onPress: () => void;
  tone?: "accent" | "neutral" | "danger";
  busy?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  const { p, radius, labels } = useTheme();
  const fill = tone === "accent" ? p.accent : tone === "danger" ? p.fail : p.surface3;
  const ink = tone === "accent" ? p.accentContrast : tone === "danger" ? p.background : p.text;
  const showWord = labels === "text" || labels === "textGlyph" || !glyph;
  const showGlyph = Boolean(glyph) && labels !== "text";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityLabel={label}
      android_ripple={{ color: p.hover }}
      style={[
        styles.button,
        {
          backgroundColor: fill,
          borderRadius: radius.control,
          opacity: disabled ? 0.5 : 1,
          flexGrow: wide === false ? 0 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} size="small" />
      ) : (
        <View style={styles.buttonInner}>
          {showGlyph ? <Text style={[styles.buttonGlyph, { color: ink }]}>{glyph}</Text> : null}
          {showWord ? <Text style={[styles.buttonText, { color: ink }]}>{label}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}

/** A labelled switch, which is what every yes-or-no question here looks like.
 *  Never a checkbox - the house rule, and on a phone a switch is also the
 *  larger target. */
export function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { p } = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={[styles.body, { color: p.text }]}>{label}</Text>
        {hint ? <Caption>{hint}</Caption> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: p.surface3, true: p.accent }}
        thumbColor={value ? p.accentContrast : p.textMuted}
      />
    </View>
  );
}

/** One of a few choices, laid out as pills. The phone's version of a segmented
 *  control, and it wraps rather than scrolling: eight accent names on one line
 *  would be a line nobody can reach the end of. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; colour?: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { p, radius } = useTheme();
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const on = option.value === value;
        const fill = option.colour ?? p.accent;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            android_ripple={{ color: p.hover }}
            style={[
              styles.choice,
              {
                borderRadius: radius.pill,
                backgroundColor: on ? fill : p.surface2,
                borderColor: on ? fill : p.border,
              },
            ]}
          >
            <Text
              style={[
                styles.choiceText,
                { color: on ? contrastOn(fill) : p.textSub },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A section of a settings page: a heading, an optional sentence, and rows. */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <Title>{title}</Title>
      {hint ? <Caption>{hint}</Caption> : null}
      <View style={styles.section}>{children}</View>
    </Card>
  );
}

/**
 * What an empty list says.
 *
 * Never a bare blank. An empty screen is indistinguishable from a broken one,
 * and on a phone there is no console to check - so every list that can be
 * empty says which of the two it is.
 */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.empty}>
      <Title>{title}</Title>
      {detail ? <Body muted>{detail}</Body> : null}
    </View>
  );
}

/** A page that scrolls, with the house padding. */
export function Page({ children }: { children: ReactNode }) {
  const { p } = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: p.background }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { padding: space.lg, gap: space.md },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.sm,
  },
  section: { gap: space.md, marginTop: space.xs },
  heading: { fontSize: text.heading, fontWeight: "600" },
  title: { fontSize: text.title, fontWeight: "600" },
  body: { fontSize: text.body },
  caption: { fontSize: text.caption },
  mono: { fontFamily: "monospace", fontSize: text.caption },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: text.caption, fontWeight: "600" },
  button: {
    minHeight: TOUCH,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: space.sm },
  buttonGlyph: { fontSize: text.title },
  buttonText: { fontSize: text.body, fontWeight: "600" },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH },
  toggleText: { flex: 1, gap: 2 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  choice: {
    minHeight: 40,
    paddingHorizontal: space.md,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  choiceText: { fontSize: text.dense, fontWeight: "600" },
  empty: { padding: space.xxl, gap: space.sm, alignItems: "center" },
});
