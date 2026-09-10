import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { palettes, radius, space, text, TOUCH, type Palette } from "./theme";

/**
 * The pieces every screen is built from.
 *
 * Small on purpose. GlimStone on the web is a large component library because
 * the desktop interface is large; a phone shows one thing at a time, and four
 * primitives cover it. Anything that turns up in three screens belongs here,
 * anything used once belongs in the screen that uses it.
 */

export function usePalette(): Palette {
  // The system's setting, not a setting of our own. A sync tool is not the
  // place somebody chooses a theme, and the web interface offers one because
  // it runs in a browser where the OS may not have an opinion. A phone always
  // does.
  return palettes[useColorScheme() === "light" ? "light" : "dark"];
}

export function Screen({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <View style={[styles.screen, { backgroundColor: p.background }]}>{children}</View>;
}

export function Card({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const body = (
    <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }, style]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  // `android_ripple` rather than an opacity change, because a ripple is what
  // every other app on the phone does and the difference is felt rather than
  // seen. This is the one place the mobile build deliberately does NOT copy
  // the web's hover ramp - there is no pointer to hover.
  return (
    <Pressable onPress={onPress} android_ripple={{ color: p.hover }} style={styles.pressable}>
      {body}
    </Pressable>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.heading, { color: p.text }]}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.title, { color: p.text }]}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const p = usePalette();
  return <Text style={[styles.body, { color: muted ? p.textMuted : p.textSub }]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.caption, { color: p.textMuted }]}>{children}</Text>;
}

export type Tone = "accent" | "neutral" | "ok" | "fail" | "warn";

export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const p = usePalette();
  const ink = { accent: p.accent, neutral: p.textMuted, ok: p.ok, fail: p.fail, warn: p.warn }[tone];
  return (
    <View style={[styles.badge, { borderColor: ink }]}>
      <Text style={[styles.badgeText, { color: ink }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = "neutral",
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: "accent" | "neutral";
  busy?: boolean;
  disabled?: boolean;
}) {
  const p = usePalette();
  const fill = tone === "accent" ? p.accent : p.surface3;
  const ink = tone === "accent" ? p.accentContrast : p.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      android_ripple={{ color: p.hover }}
      style={[styles.button, { backgroundColor: fill, opacity: disabled ? 0.5 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator color={ink} size="small" />
      ) : (
        <Text style={[styles.buttonText, { color: ink }]}>{label}</Text>
      )}
    </Pressable>
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pressable: { borderRadius: radius.card },
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.sm,
  },
  heading: { fontSize: text.heading, fontWeight: "600" },
  title: { fontSize: text.title, fontWeight: "600" },
  body: { fontSize: text.body },
  caption: { fontSize: text.caption },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: text.caption, fontWeight: "600" },
  button: {
    minHeight: TOUCH,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
  },
  buttonText: { fontSize: text.body, fontWeight: "600" },
  empty: { padding: space.xxl, gap: space.sm, alignItems: "center" },
});
