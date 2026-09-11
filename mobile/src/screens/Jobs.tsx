import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api, type Job } from "../api";
import { useT } from "../i18n";
import type { Nav, JobsStack } from "../nav";
import { space } from "../theme";
import { useEngineEvents } from "../useEngine";
import { Badge, Body, Button, Caption, Card, Empty, Title, useHue, useTheme } from "../ui";

/**
 * The jobs, and what each of them is doing right now.
 *
 * The screen somebody opens the app FOR. On a desktop this is a table with
 * eight columns; here it is one card per job, because a table on a phone is a
 * table you scroll sideways and then cannot read.
 *
 * What is on the card: is it running, which way it syncs, when it last
 * succeeded, and the two paths. What is behind a tap: everything else. That
 * split is the design - a list answers "is it keeping up", and a detail answers
 * "what exactly does this do".
 */
export function Jobs() {
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const { p } = useTheme();
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
    const stop = nav.addListener("focus", load);
    return stop;
  }, [nav, load]);

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

  if (jobs === null) return <Empty title={t("jobs.activityLoading")} detail={error || undefined} />;

  return (
    <FlatList
      style={{ backgroundColor: p.background }}
      data={jobs}
      keyExtractor={(j) => j.name}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={p.accent} />}
      ListEmptyComponent={
        <Empty title={t("jobs.title")} detail={t("jobs.empty")} />
      }
      ListHeaderComponent={
        <Button
          label={t("edit.add")}
          glyph="+"
          tone="accent"
          onPress={() => nav.navigate("JobEdit", {})}
        />
      }
      ListFooterComponent={error ? <Caption>{error}</Caption> : null}
      renderItem={({ item, index }) => (
        <JobCard
          job={item}
          index={index}
          busy={busy === item.name}
          onOpen={() => nav.navigate("JobDetail", { name: item.name })}
          onAct={() => act(item)}
        />
      )}
    />
  );
}

function JobCard({
  job,
  index,
  busy,
  onOpen,
  onAct,
}: {
  job: Job;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onAct: () => void;
}) {
  const { t } = useT();
  const hue = useHue(index);
  return (
    <Card onPress={onOpen} hue={hue}>
      <View style={styles.head}>
        <Title>{job.name}</Title>
        {job.disabled ? (
          <Badge label={t("jobs.state.disabled")} />
        ) : job.running ? (
          <Badge label={t("jobs.state.running")} tone="accent" />
        ) : job.watch ? (
          <Badge label={t("jobs.cadence.live")} tone="ok" />
        ) : null}
      </View>

      {/* The two paths with the direction between them, one per line and each
          allowed to wrap. Truncating a path in the middle is what a table
          does, and it hides exactly the part that distinguishes two similar
          jobs. */}
      <Body>{job.left}</Body>
      <Caption>{arrow(job.direction)}</Caption>
      <Body>{job.right}</Body>

      <Caption>
        {job.lastSuccess
          ? `${t("jobs.lastRun", { when: when(job.lastSuccess) })} ${t("jobs.ago")}`
          : t("jobs.activityEmpty")}
      </Caption>

      <View style={styles.actions}>
        <Button
          label={job.running ? t("jobs.pause") : t("jobs.runNow")}
          glyph={job.running ? "■" : "▶"}
          tone={job.running ? "neutral" : "accent"}
          busy={busy}
          disabled={job.disabled}
          onPress={onAct}
        />
      </View>
    </Card>
  );
}

/** The direction as an arrow, which is read faster than the word. */
export function arrow(direction: string): string {
  if (direction === "toRight" || direction === "right") return "→";
  if (direction === "toLeft" || direction === "left") return "←";
  return "↔";
}

/**
 * A timestamp as somebody would say it out loud.
 *
 * "3 hours ago" rather than a date, because the question this line answers is
 * "is this thing keeping up", and a date makes the reader do the subtraction.
 * Past a week the date IS the answer, so it switches.
 */
export function when(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} d`;
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
});
