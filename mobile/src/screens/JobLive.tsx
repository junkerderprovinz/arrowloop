import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, failed, touched, type Job, type Run } from "../api";
import { describeCadence, readCadence } from "../../../web/src/lib/cadence";
import { failureLine } from "../../../web/src/lib/failure";
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
export function JobLive({ name, check = false }: { name: string; check?: boolean }) {
  const nav = useNavigation<Nav<JobsStack>>();
  const { t, lang } = useT();
  const jobName = name;

  const [job, setJob] = useState<Job | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [found, setFound] = useState<Finding[] | null>(null);

  /**
   * Checks whether the job can work, and only then whether both sides match
   * the record: with a side missing, every file would be listed as missing and
   * bury the one finding that matters.
   */
  const look = async () => {
    setFound(null);
    const health = await api.check(jobName);
    const out: Finding[] = health.findings.map((f, i) => ({ key: `h${i}`, text: f.text, bad: f.fatal }));
    if (health.ok) {
      try {
        const seen = await api.verify(jobName);
        // An invisible finding is one no future run would notice by itself.
        out.push(...seen.findings.map((f, i) => ({ key: `v${i}`, text: `${f.path}: ${f.text}`, bad: f.invisible })));
        if (seen.truncated) {
          out.push({ key: "more", text: t("check.more", { found: seen.found, shown: seen.returned }), bad: false });
        }
      } catch (e) {
        // A refusal is an answer, such as a job that has no record yet.
        out.push({ key: "verr", text: (e as Error).message, bad: false });
      }
    }
    setFound(out);
  };

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

  useEffect(() => {
    if (check) void act("check", look);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!job) return null;

  return (
    <>
      <Section title={t("job.runCard")} hint={t("jobs.runNowHint")}>
        <View style={styles.actions}>
          <Button
            // Cancel rather than pause: the next run starts from the beginning,
            // and "pause" is the word for holding a schedule.
            label={job.running ? t("jobs.cancelRun") : t("jobs.runNow")}
            labelKey={job.running ? "jobs.cancelRun" : "jobs.runNow"}
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
            onPress={() => act("check", look)}
          />
        </View>
        {found !== null && found.length === 0 ? <Body>{t("check.healthy")}</Body> : null}
        {/* Capped, since hundreds of rows stall the scroll. */}
        {found?.slice(0, 30).map((f) => (
          <View key={f.key} style={styles.finding}>
            <Badge label={f.bad ? "!" : "?"} tone={f.bad ? "fail" : "warn"} />
            <View style={styles.findingText}>
              <Caption>{f.text}</Caption>
            </View>
          </View>
        ))}
        {found && found.length > 30 ? <Caption>{t("trash.more", { total: found.length, shown: 30 })}</Caption> : null}
      </Section>

      <Section title={t("jobs.history")} hint={runs.length ? undefined : t("jobs.historyEmpty")}>
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
            <Body>{failed(run) ? failureLine(run.Err, run.Failure, t, lang) : counters(run, t)}</Body>
          </Card>
        ))}
      </Section>

      {error ? <Caption>{error}</Caption> : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  actions: { flexDirection: "row", gap: space.sm },
  finding: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  findingText: { flex: 1 },
});

/** A line of a check's answer; bad marks one a run will not get past or notice. */
interface Finding {
  key: string;
  text: string;
  bad: boolean;
}
