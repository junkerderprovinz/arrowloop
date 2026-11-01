import { ScrollView, StyleSheet, Text } from "react-native";
import { useT } from "./i18n";
import { contrastOn, space, text } from "./theme";
import { AxisLabel, Press, useTheme } from "./ui";

/** Job chips for a filter sheet; they scroll sideways, since any number of jobs can exist. */
export function JobChips({ names, job, onJob }: { names: string[]; job: string; onJob: (next: string) => void }) {
  const { t } = useT();
  if (names.length < 2) return null;
  return (
    <>
      <AxisLabel>{t("nav.jobs")}</AxisLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={t("history.allJobs")} on={job === ""} onPress={() => onJob("")} />
        {names.map((n) => (
          <Chip key={n} label={n} on={job === n} onPress={() => onJob(n)} />
        ))}
      </ScrollView>
    </>
  );
}

/**
 * A pressable filter pill. It has a Badge's shape but is its own component,
 * since badges only report.
 */
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { p, corners, accent } = useTheme();
  return (
    <Press
      onPress={onPress}
      android_ripple={{ color: p.hover }}
      style={[styles.chip, { backgroundColor: on ? accent : p.surface2, ...corners.pill }]}
    >
      <Text numberOfLines={1} style={[styles.chipText, { color: on ? contrastOn(accent) : p.textSub }]}>
        {label}
      </Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  chips: { gap: space.sm, paddingVertical: space.xs },
  chip: { paddingHorizontal: space.md, paddingVertical: space.xs },
  chipText: { fontSize: text.meta, fontWeight: "600" },
});
