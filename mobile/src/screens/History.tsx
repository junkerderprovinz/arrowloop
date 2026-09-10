import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api, failed, touched, type Run } from "../api";
import { space } from "../theme";
import { useEngineEvents } from "../useEngine";
import { Badge, Body, Caption, Card, Empty, Title, usePalette } from "../ui";

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
  const p = usePalette();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRuns(await api.history(50));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEngineEvents(true, load);

  if (runs === null) return <Empty title="Loading" detail={error || undefined} />;
  if (runs.length === 0) {
    return <Empty title="Nothing has run yet" detail="Runs appear here as soon as one finishes." />;
  }

  return (
    <FlatList
      data={runs}
      keyExtractor={(r) => String(r.ID)}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={p.accent} />}
      renderItem={({ item }) => {
        const bad = failed(item);
        return (
          <Card>
            <View style={styles.head}>
              <Title>{item.Job}</Title>
              {bad ? (
                <Badge label="failed" tone="fail" />
              ) : touched(item) > 0 ? (
                <Badge label="changed" tone="ok" />
              ) : (
                <Badge label="nothing to do" />
              )}
            </View>

            <Caption>{stamp(item.Started)}</Caption>

            {bad ? (
              // The engine's own sentence, not a code. It was written for a
              // person, and replacing it with "an error occurred" is the one
              // way to make a failure less useful than it already is.
              <Body>{item.Err}</Body>
            ) : (
              <Body>{summary(item)}</Body>
            )}
          </Card>
        );
      }}
      ListFooterComponent={error ? <Caption>{error}</Caption> : null}
    />
  );
}

/** Only the counters that are not zero, as a sentence. */
function summary(run: Run): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(run.Copied, "file copied", "files copied");
  add(run.Moved, "file moved", "files moved");
  add(run.Trashed, "file trashed", "files trashed");
  add(run.DirsMade, "folder made", "folders made");
  add(run.DirsRemoved, "folder removed", "folders removed");
  add(run.Conflicts, "conflict", "conflicts");
  if (parts.length === 0) return "Everything was already in step.";
  return parts.join(", ");
}

function stamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
});
