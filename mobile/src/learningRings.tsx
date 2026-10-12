import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";

import { useT } from "./i18n";
import { space, text } from "./theme";
import { Press, useTheme } from "./ui";
import { LEARN_AFTER, type JobLearning } from "../../web/src/lib/anomalies";

const PARTS = 10;
const RADIUS = 23;
const ROUND = 2 * Math.PI * RADIUS;
const PART = ROUND / PARTS;
const GAP = 3;

/**
 * Every job as a ring of ten parts, one for each successful run its habits
 * were learned from, the way the web draws them. A ring still filling takes
 * the accent and a full one turns green.
 */
export function LearningRings({ learning, onOpen }: { learning: JobLearning[]; onOpen: (job: string) => void }) {
  const { t } = useT();
  const { p, accent, corners } = useTheme();
  return (
    <>
      <View style={styles.grid}>
        {learning.map((l) => {
          const lit = Math.min(PARTS, Math.floor((l.runs * PARTS) / LEARN_AFTER));
          const done = l.runs >= LEARN_AFTER;
          const say = done
            ? t("anomaly.learn.done")
            : t("anomaly.learn.progress", { count: Math.min(l.runs, LEARN_AFTER), total: LEARN_AFTER });
          return (
            <Press
              key={l.job}
              onPress={() => onOpen(l.job)}
              accessibilityRole="button"
              accessibilityLabel={`${l.job} · ${say}`}
              android_ripple={{ color: p.hover }}
              style={[styles.ring, corners.control]}
            >
              <Svg width={54} height={54} viewBox="0 0 54 54">
                {/* A circle's stroke starts at three o'clock; the turn puts the
                    first part at the top. */}
                <G rotation={-90} origin="27, 27">
                  {Array.from({ length: PARTS }, (_, i) => (
                    <Circle
                      key={i}
                      cx={27}
                      cy={27}
                      r={RADIUS}
                      fill="none"
                      strokeWidth={3.5}
                      stroke={i < lit ? (done ? p.okSolid : accent) : p.surface3}
                      strokeDasharray={`${(PART - GAP).toFixed(2)} ${ROUND.toFixed(2)}`}
                      strokeDashoffset={-(i * PART + GAP / 2)}
                    />
                  ))}
                </G>
              </Svg>
              <Text style={[styles.name, { color: p.text }]} numberOfLines={1}>
                {l.job}
              </Text>
            </Press>
          );
        })}
      </View>
      <View style={styles.legend}>
        <View style={styles.key}>
          <View style={[styles.dot, { borderColor: accent }]} />
          <Text style={[styles.keyText, { color: p.textMuted }]}>{t("anomaly.learn.learning")}</Text>
        </View>
        <View style={styles.key}>
          <View style={[styles.dot, { borderColor: p.okSolid }]} />
          <Text style={[styles.keyText, { color: p.textMuted }]}>{t("anomaly.learn.done")}</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  ring: { width: 84, alignItems: "center", gap: 6, paddingVertical: space.sm },
  name: { fontSize: text.meta, fontWeight: "500", maxWidth: 80 },
  legend: { flexDirection: "row", justifyContent: "flex-end", gap: space.md },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  keyText: { fontSize: text.meta },
});
