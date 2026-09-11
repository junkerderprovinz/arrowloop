import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, failed, touched, type Job, type Run } from "../api";
import { describeCadence, readCadence } from "../../../web/src/lib/cadence";
import { useT } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { space } from "../theme";
import { useEngineEvents } from "../useEngine";
import { Badge, Body, Button, Caption, Card, Empty, Page, Section, Title } from "../ui";
import { counters } from "./History";
import { arrow, when } from "./Jobs";

/**
 * One job: what it is, what it has been doing, and everything it can be told.
 *
 * This is where the desktop's eight columns went. The list answers "is it
 * keeping up"; this answers "what exactly does this do and what has it done",
 * and it is reached by tapping the card rather than by a row of icons nobody
 * can hit with a thumb.
 */
export function JobDetail() {
  const route = useRoute<RouteProp<JobsStack, "JobDetail">>();
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const jobName = route.params.name;

  const [job, setJob] = useState<Job | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [all, history] = await Promise.all([api.jobs(), api.jobHistory(jobName, 10)]);
      setJob(all.find((j) => j.name === jobName) ?? null);
      setRuns(history);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [jobName]);

  useEffect(() => {
    const stop = nav.addListener("focus", load);
    return stop;
  }, [nav, load]);
  useEngineEvents(true, load);

  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (!job) return <Empty title={t("jobs.activityLoading")} detail={error || undefined} />;

  return (
    <Page>
      <Card>
        <View style={styles.head}>
          <Title>{job.name}</Title>
          {job.running ? <Badge label={t("jobs.state.running")} tone="accent" /> : null}
        </View>
        <Body>{job.left}</Body>
        <Caption>{`${arrow(job.direction)}  ${t(directionKey(job.direction))}`}</Caption>
        <Body>{job.right}</Body>
        {/* The schedule in WORDS, through the desktop's own reader. Printing
            the stored expression puts `0 3 * * 1,5` on a phone card, which is
            the engine's vocabulary shown to somebody who never asked to learn
            it - and a second reader with its own idea of what that means is
            how a card ends up describing a schedule the editor shows
            differently. */}
        <Caption>{describeCadence(readCadence(job.schedule, job.watch), t)}</Caption>
      </Card>

      <Section title={t("jobs.runNow")} hint={t("jobs.runNowHint")}>
        <View style={styles.actions}>
          <Button
            label={job.running ? t("jobs.pause") : t("jobs.runNow")}
            labelKey={job.running ? "jobs.pause" : "jobs.runNow"}
            tone={job.running ? "neutral" : "accent"}
            busy={busy === "run"}
            disabled={job.disabled}
            onPress={() =>
              act("run", () => (job.running ? api.stop(job.name) : api.run(job.name)))
            }
          />
        </View>
        <View style={styles.actions}>
          {/* A PREVIEW before a run is the safety net this product is built
              around, so it is one tap from the job rather than buried. */}
          <Button
            label={t("jobs.preview")}
            labelKey="jobs.preview"
            onPress={() => nav.navigate("Plan", { name: job.name })}
          />
          <Button
            label={t("jobs.check")}
            labelKey="jobs.check"
            busy={busy === "check"}
            onPress={() => act("check", () => api.check(job.name))}
          />
        </View>
      </Section>

      <Section title={t("edit.trash")} hint={t("edit.trashHint")}>
        <View style={styles.actions}>
          <Button
            label={`${t("phone.bin")} ${t("side.left")}`}
            onPress={() => nav.navigate("Trash", { name: job.name, side: "left" })}
          />
          <Button
            label={`${t("phone.bin")} ${t("side.right")}`}
            onPress={() => nav.navigate("Trash", { name: job.name, side: "right" })}
          />
        </View>
      </Section>

      <Section title={t("jobs.activity")} hint={runs.length ? undefined : t("jobs.activityEmpty")}>
        {runs.map((run) => (
          <Card key={run.ID}>
            <View style={styles.head}>
              <Caption>{`${when(run.Started, t)} ${t("jobs.ago")}`}</Caption>
              {failed(run) ? (
                <Badge label={t("history.failed")} tone="fail" />
              ) : touched(run) > 0 ? (
                <Badge label={t("history.ok")} tone="ok" />
              ) : (
                <Badge label={t("preview.nothing")} />
              )}
            </View>
            <Body>{failed(run) ? run.Err : counters(run, t)}</Body>
          </Card>
        ))}
      </Section>

      <Section title={t("edit.editJob")}>
        <View style={styles.actions}>
          <Button
            label={t("edit.editJob")}
            labelKey="edit.editJob"
            tone="accent"
            onPress={() => nav.navigate("JobEdit", { name: job.name })}
          />
        </View>
      </Section>

      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

export function directionKey(direction: string): "direction.toRight" | "direction.toLeft" | "direction.both" {
  if (direction === "toRight" || direction === "right") return "direction.toRight";
  if (direction === "toLeft" || direction === "left") return "direction.toLeft";
  return "direction.both";
}


const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  actions: { flexDirection: "row", gap: space.sm },
});
