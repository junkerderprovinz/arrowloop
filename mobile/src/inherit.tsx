import { useState, type ReactNode } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { Glyph } from "./glyphs";
import { useT } from "./i18n";
import { space, text } from "./theme";
import { Button, InfoBubble, Press, Sheet, useTheme } from "./ui";
import { describeCadence, readCadence } from "../../web/src/lib/cadence";
import {
  SETTING_LABEL,
  describeValue,
  inForce,
  type Defaults,
  type Inherited,
} from "../../web/src/lib/follows";

/**
 * A setting the job may take from the global sync settings. While it does,
 * the control shows the value in force, dimmed and out of reach, beside a
 * lock and Override; once the job has its own value, Use the default gives it
 * back after asking, since the own value is lost (GlimStone, "Defaults and
 * exceptions").
 */
export function Inherits({
  setting,
  own,
  defaults,
  onOverride,
  onInherit,
  children,
}: {
  setting: Inherited;
  own: boolean;
  defaults: Defaults | undefined;
  onOverride: () => void;
  onInherit: () => void;
  /** The control, showing the value in force. */
  children: ReactNode;
}) {
  const { t } = useT();
  const { p } = useTheme();
  const ask = () =>
    Alert.alert(
      t("defaults.askTitle"),
      t("defaults.askOne", {
        setting: t(SETTING_LABEL[setting]),
        value: describeValue(inForce(defaults, setting), setting, t),
      }),
      [
        { text: t("confirm.cancel"), style: "cancel" },
        { text: t("defaults.useDefault"), onPress: onInherit },
      ],
    );
  return (
    <View style={styles.stack}>
      <View pointerEvents={own ? "auto" : "none"} style={own ? null : styles.locked}>
        {children}
      </View>
      <View style={styles.line}>
        {own ? null : (
          <>
            <Glyph name="IconLock" color={p.textMuted} />
            <InfoBubble tip={t("defaults.locked")} />
          </>
        )}
        <View style={styles.fill} />
        {own ? (
          <Button label={t("defaults.useDefault")} labelKey="defaults.useDefault" wide={false} onPress={ask} />
        ) : (
          <Button label={t("defaults.override")} labelKey="defaults.override" wide={false} onPress={onOverride} />
        )}
      </View>
    </View>
  );
}

/**
 * A schedule as its sentence on a button, which opens the schedule's editor
 * in a sheet, so nobody has to read a cron expression to learn when a job
 * runs. The editor keeps the cron field for one typed by hand.
 */
export function ScheduleSentence({
  label,
  value,
  watch = false,
  children,
}: {
  label: string;
  value: string;
  /** Real time, which the expression cannot say. */
  watch?: boolean;
  /** The editor. */
  children: ReactNode;
}) {
  const { t } = useT();
  const { p, corners, accentInk } = useTheme();
  const [open, setOpen] = useState(false);
  const said = describeCadence(readCadence(value, watch), t);
  const sentence = said.charAt(0).toLocaleUpperCase() + said.slice(1);
  return (
    <>
      <Press
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${sentence}`}
        onPress={() => setOpen(true)}
        android_ripple={{ color: p.hover }}
        style={[styles.sentence, { backgroundColor: p.surface2, ...corners.control }]}
      >
        <Glyph name="IconSchedules" color={accentInk} />
        <Text style={[styles.sentenceText, { color: p.text }]}>{sentence}</Text>
      </Press>
      <Sheet open={open} title={label} onClose={() => setOpen(false)}>
        {children}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xs },
  locked: { opacity: 0.4 },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  fill: { flex: 1 },
  sentence: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  sentenceText: { flex: 1, fontSize: text.body },
});
