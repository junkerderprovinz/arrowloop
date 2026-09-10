import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api, type Job } from "../api";
import { space } from "../theme";
import { useEngineEvents } from "../useEngine";
import { Badge, Body, Button, Caption, Card, Empty, Title, usePalette } from "../ui";

/**
 * The jobs, and what each of them is doing right now.
 *
 * The screen somebody opens the app FOR. On a desktop this is a table with
 * eight columns; here it is one card per job, because a table on a phone is a
 * table you scroll sideways and then cannot read.
 *
 * What survives the cut, in order: is it running, when did it last succeed,
 * and the two paths. What does not: the schedule expression, the exclusions,
 * the state database. Those belong to editing a job, which is a desk job -
 * somebody sets a sync up once at a keyboard and then watches it from a phone
 * for years.
 */
export function Jobs() {
  const p = usePalette();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs(await api.jobs());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The engine says when something changed, so the list is not on a timer. A
  // run that finishes is visible the moment it finishes.
  useEngineEvents(true, load);

  const act = async (job: Job) => {
    setBusy(job.name);
    try {
      await (job.running ? api.stop(job.name) : api.run(job.name));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (jobs === null) {
    return <Empty title="Loading" detail={error || undefined} />;
  }
  if (jobs.length === 0) {
    return (
      <Empty
        title="No jobs yet"
        detail="A job is set up at a keyboard - open ArrowLoop on a computer and add one there. It will appear here."
      />
    );
  }

  return (
    <FlatList
      data={jobs}
      keyExtractor={(j) => j.name}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={load} tintColor={p.accent} />
      }
      renderItem={({ item }) => (
        <Card>
          <View style={styles.head}>
            <Title>{item.name}</Title>
            {item.disabled ? (
              <Badge label="off" />
            ) : item.running ? (
              <Badge label="running" tone="accent" />
            ) : item.watch ? (
              <Badge label="watching" tone="ok" />
            ) : null}
          </View>

          {/* The two paths, one per line and each allowed to wrap. Truncating
              them with an ellipsis in the middle is what a table does, and it
              hides exactly the part that distinguishes two similar jobs. */}
          <Body>{item.left}</Body>
          <Body>{item.right}</Body>

          <Caption>
            {item.lastSuccess
              ? `last succeeded ${when(item.lastSuccess)}`
              : "has never finished a run"}
          </Caption>

          <View style={styles.actions}>
            <Button
              label={item.running ? "Stop" : "Run now"}
              tone={item.running ? "neutral" : "accent"}
              busy={busy === item.name}
              disabled={item.disabled}
              onPress={() => act(item)}
            />
          </View>
        </Card>
      )}
      ListFooterComponent={error ? <Caption>{error}</Caption> : null}
    />
  );
}

/**
 * A timestamp as somebody would say it out loud.
 *
 * "3 hours ago" rather than a date, because the question this line answers is
 * "is this thing keeping up", and a date makes the reader do the subtraction.
 * Past a week the date IS the answer, so it switches.
 */
function when(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
});
