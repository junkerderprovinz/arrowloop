import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, type Config, type JobConfig } from "../api";
import { Field } from "../fields";
import { useT } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { space } from "../theme";
import { Body, Button, Caption, Choice, Empty, Page, Section, Toggle } from "../ui";

/**
 * Making a job, and changing one.
 *
 * The screen jdp's list was missing, and the reason the app "did nothing":
 * without this, a phone can watch jobs somebody else made and not make one.
 * Autosync's first screen is a folder pair, and so is this.
 *
 * It edits the CONFIGURATION rather than the resolved view - the file's own
 * fields, sent back whole through /api/config, which is the same door the
 * desktop editor uses. A second, simpler path for "just a few small values" is
 * how a configuration ends up invalid in a way only the next start reveals.
 */
export function JobEdit() {
  const route = useRoute<RouteProp<JobsStack, "JobEdit">>();
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const editing = route.params?.name;

  const [config, setConfig] = useState<Config | null>(null);
  const [job, setJob] = useState<JobConfig | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.config().then(
      (c) => {
        setConfig(c);
        const found = editing ? c.jobs.find((j) => j.name === editing) : undefined;
        setJob(
          found
            ? { ...found }
            : {
                // A new job arrives DISABLED and pointing nowhere real. An
                // example that could run is an example that might, and the
                // first thing a new job should do is nothing at all.
                name: t("edit.newJob"),
                left: "",
                right: "",
                state: "",
                disabled: true,
                direction: "both",
              },
        );
      },
      (e: Error) => setError(e.message),
    );
  }, [editing, t]);

  const set = useCallback((patch: Partial<JobConfig>) => {
    setJob((old) => (old ? { ...old, ...patch } : old));
  }, []);

  const save = async () => {
    if (!config || !job) return;
    if (!job.name.trim() || !job.left.trim() || !job.right.trim()) {
      setError(t("edit.nameHint"));
      return;
    }
    setSaving(true);
    try {
      const jobs = [...config.jobs];
      const at = editing ? jobs.findIndex((j) => j.name === editing) : -1;
      // The state file is named after the job when nobody has said otherwise.
      // One file per job is the rule the engine documents, and asking somebody
      // to invent a path on a phone would be asking for a typo.
      const complete: JobConfig = {
        ...job,
        state: job.state?.trim() || `state/${job.name.trim()}.db`,
      };
      if (at >= 0) jobs[at] = complete;
      else jobs.push(complete);
      await api.writeConfig({ ...config, jobs });
      nav.goBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!config || !editing) return;
    // Asked before it happens, because this one cannot be undone from here.
    Alert.alert(t("edit.removeJob"), t("edit.removeStakes", { name: editing }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await api.writeConfig({ ...config, jobs: config.jobs.filter((j) => j.name !== editing) });
            nav.popToTop();
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
    ]);
  };

  if (!job) return <Empty title={t("jobs.activityLoading")} detail={error || undefined} />;

  return (
    <Page>
      <Section title={t("edit.name")} hint={t("edit.nameHint")}>
        <Field label={t("edit.name")} value={job.name} onChange={(name) => set({ name })} />
      </Section>

      <Section title={t("direction.label")} hint={t("edit.sideHint")}>
        <Field
          label={t("edit.left")}
          value={job.left}
          onChange={(left) => set({ left })}
          placeholder="/storage/emulated/0/DCIM"
        />
        <Choice
          value={job.direction ?? "both"}
          onChange={(direction) => set({ direction })}
          options={[
            { value: "both", label: `↔ ${t("direction.both")}` },
            { value: "toRight", label: `→ ${t("direction.toRight")}` },
            { value: "toLeft", label: `← ${t("direction.toLeft")}` },
          ]}
        />
        <Field
          label={t("edit.right")}
          value={job.right}
          onChange={(right) => set({ right })}
          placeholder="nextcloud:Photos"
        />
        <Caption>{t("direction.hint")}</Caption>
      </Section>

      <Section title={t("edit.schedule")} hint={t("edit.scheduleHint")}>
        <Schedule value={job.schedule ?? ""} onChange={(schedule) => set({ schedule })} />
        <Toggle
          label={t("schedule.live")}
          hint={t("schedule.backstopHint")}
          value={Boolean(job.watch)}
          onChange={(watch) => set({ watch })}
        />
        <Toggle
          label={t("edit.runAtStart")}
          hint={t("edit.runAtStartHint")}
          value={Boolean(job.runAtStart)}
          onChange={(runAtStart) => set({ runAtStart })}
        />
      </Section>

      <Section title={t("edit.firstRun")} hint={t("edit.firstRunHint")}>
        <Choice
          value={job.firstRun ?? "merge"}
          onChange={(firstRun) => set({ firstRun })}
          options={[
            { value: "merge", label: t("edit.firstRun.merge") },
            { value: "left", label: t("edit.firstRun.left") },
            { value: "right", label: t("edit.firstRun.right") },
          ]}
        />
      </Section>

      <Section title={t("edit.exclude")} hint={t("edit.excludeHint")}>
        <Field
          label={t("edit.exclude")}
          value={(job.exclude ?? []).join("\n")}
          onChange={(raw) =>
            set({ exclude: raw.split("\n").map((l) => l.trim()).filter(Boolean) })
          }
          multiline
          placeholder={"*.tmp\n.thumbnails/"}
        />
      </Section>

      <Section title={t("settings.general")}>
        <Toggle
          label={t("edit.trash")}
          hint={t("edit.trashHint")}
          value={!job.noTrash}
          onChange={(on) => set({ noTrash: !on })}
        />
        <Toggle
          label={t("edit.emptyDirs")}
          hint={t("edit.emptyDirsHint")}
          value={Boolean(job.emptyDirs)}
          onChange={(emptyDirs) => set({ emptyDirs })}
        />
        <Toggle
          label={t("edit.metadata")}
          hint={t("edit.metadataHint")}
          value={Boolean(job.metadata)}
          onChange={(metadata) => set({ metadata })}
        />
        <Toggle
          label={t("phone.jobOff")}
          hint={t("phone.jobOffHint")}
          value={Boolean(job.disabled)}
          onChange={(disabled) => set({ disabled })}
        />
      </Section>

      {error ? <Body>{error}</Body> : null}

      <View style={styles.actions}>
        <Button label={t("edit.save")} glyph="✓" tone="accent" busy={saving} onPress={save} />
        {editing ? (
          <Button label={t("edit.remove")} glyph="🗑" tone="danger" onPress={remove} wide={false} />
        ) : null}
      </View>
    </Page>
  );
}

/**
 * A schedule without anybody having to know cron.
 *
 * The desktop offers a builder with hour and minute pickers; this offers the
 * four answers that cover a phone - never, every fifteen minutes, hourly,
 * daily - and a field for an expression when somebody really means one. The
 * expression is what is stored either way, so a job built here and a job built
 * at a desk are the same job.
 */
function Schedule({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useT();
  const presets: Record<string, string> = {
    "": t("schedule.off"),
    "*/15 * * * *": t("jobs.cadence.every", { n: 15, unit: t("schedule.unit.minute") }),
    "0 * * * *": t("jobs.cadence.everyOne.hour"),
    "0 3 * * *": t("jobs.cadence.everyOne.day"),
  };
  const known = Object.keys(presets).includes(value);
  return (
    <View style={styles.stack}>
      <Choice
        value={known ? value : "custom"}
        onChange={(next) => onChange(next === "custom" ? value || "0 * * * *" : next)}
        options={[
          ...Object.entries(presets).map(([expression, label]) => ({ value: expression, label })),
          { value: "custom", label: t("schedule.cron") },
        ]}
      />
      {!known ? (
        <Field label={t("schedule.cron")} value={value} onChange={onChange} placeholder="0 * * * *" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.sm },
  stack: { gap: space.sm },
});
