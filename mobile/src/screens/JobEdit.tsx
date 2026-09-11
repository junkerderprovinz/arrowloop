import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, type Config, type JobConfig } from "../api";
import { Field } from "../fields";
import { useT } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { space } from "../theme";
import { sideName } from "../sides";
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

  // A job follows the defaults for as long as it says nothing itself. That is
  // the engine's own rule rather than a second one here: applyTo fills in only
  // what a job left unset.
  const follows = job?.direction === undefined && job?.mode === undefined;

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

      {/* Two explanations, one bubble. The sides' own sentence used to sit
          under the fields as a caption; the card already had a bubble, so the
          second sentence joins it rather than starting a second convention. */}
      <Section
        title={t("direction.label")}
        hint={`${t("edit.sideHint")} ${t("direction.hint")}`}
        hue={1}
      >
        {/* Following the default is a STATE, not a link that appears once
            something has been overridden, so it gets the control every state in
            this house gets. On, the job says nothing about either setting and
            the engine fills both in from the settings; off, the job's own
            answers are written down, starting from whatever it is doing now so
            nothing visibly jumps. */}
        <Toggle
          label={t("defaults.follow")}
          hint={t("defaults.followHint")}
          value={follows}
          hue={0}
          onChange={(on) =>
            on
              ? set({ direction: undefined, mode: undefined })
              : set({ direction: job.direction ?? "both", mode: job.mode ?? "sync" })
          }
        />
        {/* Each side is named after what it IS, not after which column it
            would sit in on a desk. "Left" and "right" mean nothing on a phone,
            where there are no two columns - and naming them "local" and
            "cloud" the way a phone-only tool does would be a lie the first
            time somebody points both sides at the same machine. A path on the
            handset says so; a target says its own name. */}
        <Field
          label={sideName(job.left, t)}
          value={job.left}
          onChange={(left) => set({ left })}
          placeholder="/storage/emulated/0/DCIM"
        />
        <Choice
          value={job.direction ?? "both"}
          disabled={follows}
          onChange={(direction) => set({ direction, mode: direction === "both" ? "sync" : job.mode })}
          options={[
            // The engine's own spellings. They used to be "toRight" and
            // "toLeft" here, which ParseDirection does not recognise at all -
            // so it fell through to its safe default and every one-way job on
            // this app quietly ran both ways.
            { value: "both", label: t("direction.both") },
            { value: "leftToRight", label: t("direction.toRight") },
            { value: "rightToLeft", label: t("direction.toLeft") },
          ]}
        />
        <Field
          label={sideName(job.right, t, "target")}
          value={job.right}
          onChange={(right) => set({ right })}
          placeholder="nextcloud:Photos"
        />
      </Section>

      {/* The second axis, and it only exists once a side has been named the
          source. Two of the three modes DELETE, so each carries a sentence
          saying what it removes and what it leaves: a picker of three words
          is how somebody mirrors the wrong way round. */}
      <Section
        title={t("mode.label")}
        // What the chosen mode DELETES, in the card's (i). Two of the three
        // remove files, so the sentence matters - and it moved here rather than
        // staying a caption under the picker because that is where every
        // explanation in this app now lives, on both surfaces. It follows the
        // selection, so the bubble always describes the mode actually set.
        hint={
          (job.direction ?? "both") === "both"
            ? t("mode.onlyOneWay")
            : job.mode === "mirror"
              ? t("mode.mirrorHint")
              : job.mode === "move"
                ? t("mode.moveHint")
                : t("mode.syncHint")
        }
        hue={2}
      >
        {/* Inert with `sync` showing for a both-ways job, rather than replaced
            by a paragraph: a card that changes shape with the answer above it
            is two cards somebody has to recognise as one. */}
        <Choice
          value={(job.direction ?? "both") === "both" ? "sync" : (job.mode ?? "sync")}
          disabled={follows || (job.direction ?? "both") === "both"}
          onChange={(mode) => set({ mode })}
          options={[
            { value: "sync", label: t("mode.sync") },
            { value: "mirror", label: t("mode.mirror") },
            { value: "move", label: t("mode.move") },
          ]}
        />
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
        {/* The "switched off" toggle used to sit here, and it is gone. jdp:
            "dieser abgeschaltet toggle soll weg, das hab ich schon oft
            angesprochen." Holding a job is not a property of how it is
            CONFIGURED, it is something you do to it - the same class of act as
            running it now - so it belongs where you look at the job rather than
            where you edit it. That is where the desktop has always had it, as a
            hold/resume button on the row, and the phone's card carries the same
            pair now. */}
      </Section>

      {error ? <Body>{error}</Body> : null}

      <View style={styles.actions}>
        <Button label={t("edit.save")} labelKey="edit.save" tone="accent" busy={saving} onPress={save} />
        {editing ? (
          <Button label={t("edit.remove")} labelKey="edit.remove" tone="danger" onPress={remove} wide={false} />
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
