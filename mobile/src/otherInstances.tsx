import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { jobStatus } from "../../web/src/lib/jobList";
import { api, type Job, type OtherInstance } from "./api";
import { clock } from "./clock";
import { Refusal } from "./fields";
import { useT } from "./i18n";
import { kindName, seenAt } from "./pairing";
import { space, text } from "./theme";
import { Badge, Body, Button, Caption, Section, useTheme } from "./ui";

// How often the overview asks the other instances again. Their runs reach the
// phone only by asking.
const REFRESH_MS = 15_000;

/**
 * The jobs of every instance paired with this phone, a card per instance. A
 * job there can be started or stopped from here, and everything else is
 * changed on the instance itself. Outside a group, or with an engine that
 * cannot pair, it draws `empty`, once the engine has answered.
 */
export function OtherInstances({ firstHue, empty = null }: { firstHue: number; empty?: ReactNode }) {
  const { t, lang } = useT();
  const [instances, setInstances] = useState<OtherInstance[] | null>(null);

  const load = useCallback(() => {
    api.instances().then(
      setInstances,
      () => setInstances([]),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, REFRESH_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  if (!instances) return null;
  if (instances.length === 0) return empty;
  return (
    <>
      {instances.map((other, i) => {
        const kind = kindName(t, other.deployment);
        let note = "";
        if (other.state === "approve") note = t("instances.approve");
        if (other.state === "waiting") note = t("instances.waiting");
        if (other.state === "away") note = t("instances.away", { time: seenAt(lang, other.lastSeen ?? 0) });
        if (other.state === "error") note = t("instances.error", { reason: other.error ?? "" });
        const jobs = other.jobs ?? [];
        return (
          <Section
            key={other.id}
            title={other.name || kind}
            hint={i === 0 ? t("instances.hint") : undefined}
            hue={firstHue + i}
          >
            {kind && other.name ? <Caption>{kind}</Caption> : null}
            {note ? <Body>{note}</Body> : null}
            {other.state === "ok" && jobs.length === 0 ? <Body muted>{t("instances.noJobs")}</Body> : null}
            {other.state === "ok"
              ? jobs.map((job) => <OtherJob key={job.name} instance={other} job={job} onChanged={load} />)
              : null}
          </Section>
        );
      })}
    </>
  );
}

/** One job of another instance: its name, its status and Run now or Cancel the run. */
function OtherJob({ instance, job, onChanged }: { instance: OtherInstance; job: Job; onChanged: () => void }) {
  const { t } = useT();
  const { p, corners } = useTheme();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);

  async function press() {
    setBusy(true);
    setSaid(null);
    try {
      if (job.running) {
        await api.stopOnInstance(instance.id, job.name);
      } else {
        await api.runOnInstance(instance.id, job.name);
        setSaid({ text: t("instances.started", { job: job.name, name: instance.name }), ok: true });
      }
      onChanged();
    } catch (e) {
      setSaid({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.well, { backgroundColor: p.surface2, ...corners.card }]}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[styles.name, { color: p.text }]} numberOfLines={1}>
            {job.name}
          </Text>
          <Status job={job} />
        </View>
        <Button
          label={job.running ? t("jobs.cancelRun") : t("jobs.runNow")}
          labelKey={job.running ? "jobs.cancelRun" : "jobs.runNow"}
          glyphOnly
          wide={false}
          busy={busy}
          disabled={job.disabled && !job.running}
          onPress={() => void press()}
        />
      </View>
      {said ? said.ok ? <Caption>{said.text}</Caption> : <Refusal text={said.text} /> : null}
    </View>
  );
}

/**
 * The job's one status, by the web list's rule. The phone cannot see the other
 * instance's holds, conflicts or notes, so those never show here.
 */
function Status({ job }: { job: Job }) {
  const { t, lang } = useT();
  const { p } = useTheme();
  switch (jobStatus(job, { held: false, conflict: false, notes: false })) {
    case "running":
      return <Badge label={t("jobs.state.running")} tone="accent" />;
    case "failed":
      return <Badge label={t("status.failed")} tone="fail" />;
    case "warned":
      return <Badge label={t("status.warned")} tone="warn" />;
    case "paused":
      return <Badge label={t("jobs.state.disabled")} />;
    case "never":
      return <Caption>{t("jobs.historyEmpty")}</Caption>;
    default: {
      const last = job.lastSuccess ?? job.recent[0]?.Finished;
      return (
        <View style={styles.quiet}>
          <View style={[styles.dot, { backgroundColor: p.okSolid }]} />
          {last ? <Caption>{t("jobs.lastRun", { when: clock(last, lang) })}</Caption> : null}
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  well: { padding: space.md, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  text: { flex: 1, minWidth: 0, gap: space.xs, alignItems: "flex-start" },
  name: { fontSize: text.body, fontWeight: "600" },
  quiet: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
