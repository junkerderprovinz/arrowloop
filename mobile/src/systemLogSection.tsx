import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api, type SystemLine } from "./api";
import { clock } from "./clock";
import { useT } from "./i18n";
import { logRows } from "./systemLog";
import { space, text } from "./theme";
import { Badge, Body, Caption, Section, useTheme } from "./ui";

/**
 * How many lines the card shows. The settings scroll as one page on a phone,
 * so it shows fewer than the web's card, which scrolls on its own.
 */
const SHOWN = 30;

/** The errors from rclone, the connections and the integrations, newest first, as on the web's General tile. */
export function SystemLogSection({ hue }: { hue: number }) {
  const { t, lang } = useT();
  const { p } = useTheme();
  const [lines, setLines] = useState<SystemLine[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    api.systemLog(SHOWN).then(
      (got) => current && setLines(got),
      (e: Error) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
  }, []);

  return (
    <Section title={t("systemLog.title")} hint={t("systemLog.hint")} hue={hue}>
      {lines === null ? (
        <Body muted>{error || t("engine.loading")}</Body>
      ) : lines.length === 0 ? (
        <Body muted>{t("systemLog.empty")}</Body>
      ) : (
        logRows(lines, t).map((row, i) => (
          <View key={row.id} style={[styles.line, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border } : null]}>
            <View style={styles.head}>
              <Badge label={row.source} />
              <Caption>{clock(row.at, lang)}</Caption>
              {row.repeat ? <Badge label={row.repeat} tone="warn" /> : null}
            </View>
            <Text selectable style={[styles.text, { color: p.text }]}>
              {row.text}
            </Text>
          </View>
        ))
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  line: { gap: space.xs, paddingVertical: space.sm },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  text: { fontSize: text.body },
});
