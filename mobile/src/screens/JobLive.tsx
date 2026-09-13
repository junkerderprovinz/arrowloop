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
/**
 * What a job DOES, at the top of the page that says what it is.
 *
 * Was a page of its own until 2026-09-13. jdp: "ist irgendwie bloed wenn man
 * zwei unterschiedliche seiten pro auftrag hat die unterschiedliches zeigen."
 * The split ran along a line nobody could see - doing on one page, being on the
 * other - and the two words for reaching them said nothing about which was
 * which.
 *
 * Only for a job that EXISTS. A job being typed has nothing to run, no trash and
 * no history, and four empty sections above the fields would be worse than none.
 */
export function JobLive({ name }: { name: string }) {
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
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

  // Nothing at all until the job is known: four empty sections above the
  // fields would be worse than none.
  if (!job) return null;

  return (
    <>
      {/* NO status card. Name, paths, direction and schedule are all fields a
          few lines below this now, and printing them twice on one page is the
          kind of duplication that starts disagreeing with itself. What is left
          here is what the fields cannot say: whether it is running, what it did
          last, and what is in its trash. */}

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

      {/* No link to the editor: this IS the editor, a few lines further down. */}
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
