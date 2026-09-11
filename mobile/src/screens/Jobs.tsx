import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api, type Job } from "../api";
import { useT, type T } from "../i18n";
import { since } from "../../../web/src/lib/since";
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
  const { p, accent } = useTheme();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [holding, setHolding] = useState<string | null>(null);

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

  /**
   * Hold a job, or let it go again.
   *
   * Read-modify-write of the whole configuration, because that is the only
   * shape the engine offers and the same one the editor uses to save. The read
   * happens HERE rather than from the list on screen: `api.jobs()` returns live
   * state - what is running, when it last succeeded - and writing that back as
   * configuration would persist a snapshot of the moment as settings.
   */
  const hold = async (job: Job) => {
    setHolding(job.name);
    try {
      const config = await api.config();
      await api.writeConfig({
        ...config,
        jobs: config.jobs.map((j) => (j.name === job.name ? { ...j, disabled: !job.disabled } : j)),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHolding(null);
    }
  };

  if (jobs === null) return <Empty title={t("jobs.activityLoading")} detail={error || undefined} />;

  return (
    <FlatList
      style={{ backgroundColor: p.background }}
      data={jobs}
      keyExtractor={(j) => j.name}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={accent} />}
      // NOTHING where there is nothing, and that is not a bare blank: the
      // "Add job" button sits directly above this, so the empty list already
      // says what it is and what to do about it. A sentence under a button that
      // makes the same offer is the offer twice, and on a phone it costs the
      // first screenful. jdp: "in der Aufträge und ziele seite soll der hinweis
      // text weg wenn noch kein auftrag oder ziel vorhanden ist."
      //
      // The LOADING and FAILED states above keep their own words, and that is
      // the distinction worth holding: an empty list with a button is a state
      // somebody can act on, while a list that is still arriving or could not
      // be fetched is not - and those two really are indistinguishable from a
      // blank screen.
      ListHeaderComponent={
        <Button
          label={t("edit.add")}
          labelKey="edit.add"
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
          holding={holding === item.name}
          onHold={() => hold(item)}
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
  holding,
  onHold,
}: {
  job: Job;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onAct: () => void;
  /** Whether the hold is being written right now. */
  holding: boolean;
  onHold: () => void;
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
          ? `${t("jobs.lastRun", { when: when(job.lastSuccess, t) })} ${t("jobs.ago")}`
          : t("jobs.activityEmpty")}
      </Caption>

      {/* Two verbs, never one button, which is the desktop's own rule for this
          pair: a job held on its schedule can still be STARTED by hand, and
          that is the whole point of holding one rather than deleting it.

          `jobs.stopRun` rather than `jobs.pause` for the left button. Pausing
          is what the right one does - it holds the schedule - and one card able
          to print the same word for two different acts is how somebody stops a
          run when they meant to stop a job. */}
      <View style={styles.actions}>
        <Button
          label={job.running ? t("jobs.stopRun") : t("jobs.runNow")}
          labelKey={job.running ? "jobs.stopRun" : "jobs.runNow"}
          tone={job.running ? "neutral" : "accent"}
          busy={busy}
          onPress={onAct}
        />
        <Button
          label={job.disabled ? t("jobs.resume") : t("jobs.pause")}
          labelKey={job.disabled ? "jobs.resume" : "jobs.pause"}
          busy={holding}
          onPress={onHold}
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
 * A timestamp as somebody would say it out loud, in the reader's own language.
 *
 * This used to be a second implementation that returned `"just now"`, `"3 h"`
 * and `"2 d"` as English literals, which the card then wrapped in translated
 * text: a German screen read "zuletzt just now her", which is neither a
 * language nor a sentence. Measured on the device.
 *
 * The rule is the desktop's, from `lib/since.ts`, and it returns the unit as a
 * translation KEY rather than a word - which is the only shape that can be said
 * in forty-two languages.
 */
export function when(iso: string, t: T): string {
  const { count, unit } = since(iso);
  return `${count} ${t(unit)}`;
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
