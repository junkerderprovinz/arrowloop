import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { useT } from "./i18n";
import { useMotion } from "./motion";
import { softOn, space, text } from "./theme";
import { Press, Toggle, useTheme } from "./ui";

/**
 * The job's one switch between the global sync settings and values of its
 * own. Every increment of `nudge` draws the eye to it: a wobble, or at the
 * motion level off a brief wash of the accent, which moves nothing.
 */
export function GlobalSwitch({
  value,
  onChange,
  disabled,
  nudge,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  nudge: number;
}) {
  const { t } = useT();
  const { p, corners, accent } = useTheme();
  const { ms } = useMotion();
  const wobble = useRef(new Animated.Value(0)).current;
  const [lit, setLit] = useState(false);

  useEffect(() => {
    if (!nudge) return;
    if (!ms.fade) {
      setLit(true);
      const off = setTimeout(() => setLit(false), LIT_FOR);
      return () => clearTimeout(off);
    }
    const leg = Math.round(ms.fade / 2);
    Animated.sequence(
      [1, -1, 0.6, -0.6, 0].map((to) => Animated.timing(wobble, { toValue: to, duration: leg, useNativeDriver: true })),
    ).start();
  }, [nudge, ms.fade, wobble]);

  return (
    <Animated.View
      style={[
        styles.switch,
        {
          backgroundColor: lit ? softOn(accent, 0.28) : p.surface,
          ...corners.card,
          transform: [{ translateX: wobble.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) }],
        },
      ]}
    >
      <Toggle
        label={t("edit.useGlobal")}
        hint={t("edit.useGlobalHint")}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </Animated.View>
  );
}

/** How long the wash stays when the switch cannot wobble, in ms. */
const LIT_FOR = 900;

/**
 * A control showing a value the job takes from the global sync settings:
 * dimmed, out of reach and marked global. A tap on it calls `onPress`, which
 * points at the switch that gives the job its own values. `label` is what a
 * screen reader says for it, the setting and its value.
 */
export function FromGlobal({
  follows,
  label,
  onPress,
  children,
}: {
  follows: boolean;
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const { p, corners } = useTheme();
  if (!follows) return <>{children}</>;
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${t("edit.global")}`}
      accessibilityHint={t("edit.useGlobalHint")}
      style={styles.stack}
    >
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.dimmed}>
        {children}
      </View>
      <View style={styles.markRow}>
        <Text style={[styles.mark, { color: p.textMuted, backgroundColor: p.surface2, ...corners.pill }]}>
          {t("edit.global")}
        </Text>
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  switch: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  stack: { gap: space.xs },
  dimmed: { opacity: 0.4 },
  markRow: { flexDirection: "row", justifyContent: "flex-end" },
  mark: { fontSize: text.meta, paddingHorizontal: space.sm, paddingVertical: 2, overflow: "hidden" },
});
