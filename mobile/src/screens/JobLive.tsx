import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, failed, touched, type Job, type Run } from "../api";
import { describeCadence, readCadence } from "../../../web/src/lib/cadence";
import { useT } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { space } from "../theme";
import { useEngineEvents } from "../useEngine";
import { Badge, Body, Button, Caption, Card, Section } from "../ui";
import { counters } from "./History";
import { clock } from "../clock";
import { arrow } from "./Jobs";

/**
 * The actions and recent runs of a saved job, shown above its fields in
 * JobEdit. A job still being typed has none of either.
 */
export function JobLive({ name }: { name: string }) {
  const nav = useNavigation<Nav<JobsStack>>();
  const { t, lang } = useT();
  const jobName = name;

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
    // Loaded on mount as well: this mounts inside a screen that is already
    // focused, so the first `focus` event has passed.
    void load();
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

  if (!job) return null;

  return (
    <>
      <Section title={t("jobs.runNow")} hint={t("jobs.runNowHint")}>
        <View style={styles.actions}>
          <Button
            // Cancel rather than pause: the next run starts from the beginning,
            // and "pause" is the word for holding a schedule.
            label={job.running ? t("jobs.cancelRun") : t("jobs.runNow")}
            labelKey={job.running ? "jobs.cancelRun" : "jobs.runNow"}
            tone={job.running ? "neutral" : "accent"}
            busy={busy === "run"}
            disabled={job.disabled}
            onPress={() =>
              act("run", () => (job.running ? api.stop(job.name) : api.run(job.name)))
            }
          />
        </View>
        <View style={styles.actions}>
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

      <Section title={t("jobs.activity")} hint={runs.length ? undefined : t("jobs.activityEmpty")}>
        {runs.map((run) => (
          <Card key={run.ID}>
            <View style={styles.head}>
              <Caption>{clock(run.Started, lang)}</Caption>
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

      {error ? <Caption>{error}</Caption> : null}
    </>
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
