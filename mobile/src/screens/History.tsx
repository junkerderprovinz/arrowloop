import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api, failed, touched, type Run } from "../api";
import { useT, type T } from "../i18n";
import type { HistoryStack, Nav } from "../nav";
import { space } from "../theme";
import { useEngineEvents } from "../useEngine";
import { Badge, Body, Caption, Card, Choice, Empty, Title, useTheme } from "../ui";
import { when } from "./Jobs";

/**
 * What has happened, newest first.
 *
 * One card per run, and the card answers one question: did this run do
 * anything, and did it go wrong. The desktop shows nine counters per run in a
 * table; nine numbers in a row on a phone is a wall, and eight of them are
 * zero on an ordinary night.
 *
 * So the counters are FILTERED to the ones that are not zero, and a run that
 * changed nothing says so in words. That is not a simplification of the
 * desktop view - it is the same information, minus the zeroes nobody reads.
 */
export function History() {
  const nav = useNavigation<Nav<HistoryStack>>();
  const { t } = useT();
  const { p } = useTheme();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [show, setShow] = useState<"all" | "changed" | "failed">("all");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRuns(await api.history(100));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const stop = nav.addListener("focus", load);
    return stop;
  }, [nav, load]);
  useEngineEvents(true, load);

  // Filtered HERE rather than by asking again. A hundred runs is a small list
  // and a round trip per tap on a filter is a screen that feels slow for no
  // reason anybody can see.
  const shown = useMemo(() => {
    if (!runs) return [];
    if (show === "failed") return runs.filter(failed);
    if (show === "changed") return runs.filter((r) => touched(r) > 0);
    return runs;
  }, [runs, show]);

  if (!runs) return <Empty title={t("history.loading")} detail={error || undefined} />;

  return (
    <FlatList
      style={{ backgroundColor: p.background }}
      data={shown}
      keyExtractor={(r) => String(r.ID)}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={p.accent} />}
      ListHeaderComponent={
        <Choice
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: t("history.showAll") },
            { value: "changed", label: t("history.showChanged") },
            { value: "failed", label: t("history.showFailed") },
          ]}
        />
      }
      ListEmptyComponent={
        <Empty
          title={runs.length === 0 ? t("history.empty") : t("history.noMatch")}
          detail={runs.length === 0 ? t("history.nothing") : undefined}
        />
      }
      ListFooterComponent={error ? <Caption>{error}</Caption> : null}
      renderItem={({ item }) => (
        <Card onPress={() => nav.navigate("RunDetail", { id: item.ID, job: item.Job })}>
          <View style={styles.head}>
            <Title>{item.Job}</Title>
            {failed(item) ? (
              <Badge label={t("history.failed")} tone="fail" />
            ) : touched(item) > 0 ? (
              <Badge label={t("history.ok")} tone="ok" />
            ) : null}
            {/* A run that changed nothing gets no badge at all, and that is
                the fix rather than a shorter one: the sentence for it is a
                whole sentence, and a whole sentence beside a title is a pill
                as wide as the card with its last word cut off. The counters
                below already say it. */}
          </View>
          <Caption>{`${when(item.Started)} ${t("jobs.ago")}`}</Caption>
          {failed(item) ? (
            // The engine's own sentence, not a code. It was written for a
            // person, and replacing it with "an error occurred" is the one way
            // to make a failure less useful than it already is.
            <Body>{item.Err}</Body>
          ) : (
            <Body>{counters(item, t)}</Body>
          )}
        </Card>
      )}
    />
  );
}

export function counters(run: Run, t: T): string {
  const parts: string[] = [];
  // The keys carry their own placeholder - `copied: {count}` - so the number
  // goes INSIDE rather than in front. Putting it in front produced
  // "3 kopiert: {count}" on screen, which is the placeholder showing through.
  const add = (n: number, key: "history.copied" | "history.moved" | "history.trashed" | "history.conflicts") => {
    if (n > 0) parts.push(t(key, { count: n }));
  };
  add(run.Copied, "history.copied");
  add(run.Moved, "history.moved");
  add(run.Trashed, "history.trashed");
  add(run.Conflicts, "history.conflicts");
  if (parts.length === 0) return t("preview.identical", { count: run.Unchanged });
  return parts.join(", ");
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
});
