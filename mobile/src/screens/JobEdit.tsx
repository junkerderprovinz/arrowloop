import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api, type Config, type JobConfig } from "../api";
import { Field, TimeField } from "../fields";
import { FolderPicker } from "../FolderPicker";
import { Glyph } from "../glyphs";
import { useT } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { contrastOn, space, text } from "../theme";
import { sideName } from "../sides";
import { animateNext, useMotion } from "../motion";
import { AxisLabel, Body, Button, Caption, Choice, Empty, Page, Section, Toggle, useTheme } from "../ui";
import {
  buildSchedule,
  EVERY_UNITS,
  parseSchedule,
  WEEKDAYS,
  type EveryUnit,
  type ScheduleMode,
  type ScheduleState,
} from "../../../web/src/lib/schedule.data";

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
                // A new job arrives SWITCHED ON, the same as on the desktop,
                // and the phone was the odd one out. jdp said it there in as
                // many words: "Abgeschaltet: das find ich total daemlich. ein
                // auftrag soll standardmaessig aktiviert sein."
                //
                // The old reasoning was that a job pointing nowhere should not
                // be reachable by a scheduler, which is true and is not this
                // flag's job: a new job has no schedule either, so there is
                // nothing to reach it with. What the flag actually did was make
                // every job somebody created say "abgeschaltet" on its own card
                // until they found the switch.
                // It names NEITHER direction nor mode, which is what makes it
                // follow the global sync settings from its first moment. jdp:
                // "in den aufträgen sollen die globalen einstellungen per
                // toggle deaktiviert werden können, standardmäßig sollen sie
                // aktiviert sein." It used to arrive with `direction: "both"`,
                // which IS an answer of its own - so every new job silently
                // opted out of the settings it was supposed to start from, and
                // the switch that says so came up off.
                name: t("edit.newJob"),
                left: "",
                right: "",
                state: "",
              },
        );
      },
      (e: Error) => setError(e.message),
    );
  }, [editing, t]);

  /**
   * A job follows the global sync settings for as long as it says nothing
   * itself. That is the engine's own rule rather than a second one here:
   * `applyTo` fills in only what a job left unset.
   *
   * EVERY field the settings cover, not just the first two. It used to read
   * direction and mode alone, which made a switch labelled "use the defaults"
   * that was true while the job carried its own schedule. The engine's Defaults
   * fills in direction, mode, schedule, empty folders and metadata, so those
   * five are what the switch is about.
   */
  const OWNED = ["direction", "mode", "schedule", "emptyDirs", "metadata"] as const;
  const follows = OWNED.every((key) => job?.[key] === undefined);

  /**
   * Turning it off writes down what the job is doing RIGHT NOW.
   *
   * Not the engine's defaults and not a blank: whatever is on screen is what
   * somebody just looked at, so nothing visibly jumps at the moment the
   * options appear. Turning it back on clears all five, which is the only way
   * to say "no opinion" in a file where absent is the opinion.
   */
  const setFollows = (on: boolean) => {
    if (on) {
      set({
        direction: undefined,
        mode: undefined,
        schedule: undefined,
        emptyDirs: undefined,
        metadata: undefined,
      });
      return;
    }
    set({
      direction: job?.direction ?? "both",
      mode: job?.mode ?? "sync",
      schedule: job?.schedule ?? "",
      emptyDirs: job?.emptyDirs ?? false,
      metadata: job?.metadata ?? false,
    });
  };

  /** Which field the folder picker is open on, or nothing. */
  const [picking, setPicking] = useState<"left" | "right" | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  useEffect(() => {
    api.storage().then(
      (list) => setTargets(list.remotes.map((r) => r.name)),
      // A picker with no targets in it is still a picker for the phone's own
      // folders, so an unreachable list is a shorter list rather than an error.
      () => setTargets([]),
    );
  }, []);

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

      {/* THE TWO SIDES, always, because they are what makes this job this job
          and no setting anywhere can fill them in.

          Each side is named after what it IS, not after which column it would
          sit in on a desk. "Left" and "right" mean nothing on a phone, where
          there are no two columns - and naming them "local" and "cloud" the
          way a phone-only tool does would be a lie the first time somebody
          points both sides at the same machine. */}
      <Section title={t("edit.sides")} hint={t("edit.sideHint")} hue={1}>
        <View style={styles.pickRow}>
          <View style={styles.pickField}>
            <Field
              label={sideName(job.left, t)}
              value={job.left}
              onChange={(left) => set({ left })}
              placeholder="/storage/emulated/0/DCIM"
            />
          </View>
          <Button
            label={t("pick.title")}
            labelKey="pick.title"
            mark={(ink) => <Glyph name="IconFolder" color={ink} />}
            onPress={() => setPicking("left")}
          />
        </View>
        <View style={styles.pickRow}>
          <View style={styles.pickField}>
            <Field
              label={sideName(job.right, t, "target")}
              value={job.right}
              onChange={(right) => set({ right })}
              placeholder="nextcloud:Photos"
            />
          </View>
          <Button
            label={t("pick.title")}
            labelKey="pick.title"
            mark={(ink) => <Glyph name="IconFolder" color={ink} />}
            onPress={() => setPicking("right")}
          />
        </View>
      </Section>

      {/* THE SWITCH, on its own card and above everything it governs.
          Default ON, and while it is on the options are ABSENT rather than
          greyed: a form that follows the settings used to look exactly as long
          as one that does not, with nine dead controls in it. Switching it off
          is what makes them appear. */}
      <Section title={t("engine.defaults")} hint={t("defaults.followHint")} hue={0}>
        <Toggle
          label={t("defaults.follow")}
          value={follows}
          hue={0}
          onChange={setFollows}
        />
      </Section>

      {!follows ? (
        <Section title={t("direction.label")} hint={t("direction.hint")} hue={2}>
          <Choice
            value={job.direction ?? "both"}
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
        </Section>
      ) : null}

      {!follows ? (
      <>
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
          disabled={(job.direction ?? "both") === "both"}
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
      </>
      ) : null}

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
        {!follows ? (
          <>
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
          </>
        ) : null}
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
      <FolderPicker
        visible={picking !== null}
        start={picking === "left" ? job.left : job.right}
        // Targets only for the side that can be one. Offering them on the
        // handset's own side would be offering a path it cannot reach.
        targets={picking === "right" ? targets : []}
        onPick={(path) => {
          if (picking) set({ [picking]: path } as Partial<JobConfig>);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Page>
  );
}

/**
 * A schedule without anybody having to know cron - and every answer reachable.
 *
 * It used to offer four fixed presets and a "Cron" segment, and the segment did
 * not work: picking it wrote `0 * * * *`, which IS one of the four presets, so
 * the well jumped straight back to "hourly" and the field vanished before
 * anybody could type in it. From outside that reads as "Cron kann man auch
 * nicht einstellen", which is exactly what it was.
 *
 * Nor could an interval be chosen: fifteen minutes, an hour and a day were the
 * whole of what a phone could ask for, so "every three hours" needed a cron
 * expression somebody had to know how to write. jdp: "alle N muss man selbst
 * wählen können (min, h, tage)."
 *
 * SO IT READS THE SHARED MODEL NOW, `lib/schedule.data.ts`, which the container
 * has edited through all along: off, every N, daily at a time, weekdays at a
 * time, or a raw expression. That file already knew all of it - the app simply
 * never asked. One parser and one writer for both surfaces, so a job built here
 * and a job built at a desk are the same job and read the same on both cards.
 */
export function Schedule({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useT();
  // The stored expression, read into the builder's own terms. Anything this
  // builder does not recognise comes back as `cron` rather than being guessed
  // at, which is what keeps a hand-written expression editable instead of
  // silently rewritten.
  const { intensity: motion } = useMotion();
  const derived = parseSchedule(value);

  /**
   * THE MODE LIVES HERE, and that is the whole of the fix.
   *
   * It was read back out of the stored expression on every render, which works
   * for every mode except the one that cannot always express itself. Picking
   * Cron writes `state.cron`, which starts EMPTY - and an empty expression
   * reads back as "off", so the well jumped straight back and no field ever
   * appeared. jdp: "cron geht nicht. es kommt kein feld zum einstellen."
   *
   * The container's own copy of this control was fixed the same way a round
   * earlier, for the mirror-image case: switching to cron there seeded the
   * field from the schedule already set, so the stored string read back as
   * "daily". Two different starting points, one cause - a builder whose only
   * memory is its own output cannot hold a state that output does not yet
   * describe. The phone never got the fix, which is exactly the sibling drift
   * a shared parser was supposed to end: the DATA moved to one file and the
   * bug fix did not.
   *
   * The stored value stays the single source of truth for the SETTINGS. Only
   * which picker is open lives here, re-seeded whenever the value changes from
   * outside, so opening another job never shows the last one's mode.
   */
  const [mode, setMode] = useState<ScheduleMode>(derived.mode);
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value;
      setMode(parseSchedule(value).mode);
    }
  }, [value]);

  const state: ScheduleState = { ...derived, mode };
  const set = (patch: Partial<ScheduleState>) => {
    const next = { ...state, ...patch };
    if (patch.mode !== undefined) setMode(patch.mode);
    const built = buildSchedule(next);
    seen.current = built;
    onChange(built);
  };

  return (
    <View style={styles.stack}>
      <Choice<ScheduleMode>
        value={state.mode}
        // `live` is the container's own mode and is absent here on purpose: it
        // is the watcher, and whether a job WATCHES is stored on the job rather
        // than in the expression - so offering it in a picker that only writes
        // an expression would be a switch that does nothing.
        // Each mode shows a different set of rows underneath - a number and a
        // unit, a time, seven day chips, an expression - so the card's height
        // changes on every pick. The clearest case for animating a layout there
        // is.
        onChange={(mode) => {
          animateNext(motion);
          set({ mode });
        }}
        options={[
          { value: "off", label: t("schedule.off") },
          { value: "every", label: t("schedule.every") },
          { value: "daily", label: t("schedule.daily") },
          { value: "weekly", label: t("schedule.weekly") },
          { value: "cron", label: t("schedule.cron") },
        ]}
      />

      {/* HOW MANY, and OF WHAT. Two controls rather than a list of intervals,
          because the list would be as long as the numbers somebody might want:
          five minutes, twenty minutes, three hours, ten days. A number and a
          unit cover all of it in the space of one row.

          `@every` rather than a STEP expression is the shared writer's own
          decision and worth knowing: a step in the hours column fires at 0, 6,
          12 and 18 o'clock, so "every six hours" set at five waits one hour and
          then keeps to a clock nobody asked about. `@every 6h` counts from the
          last run, which is what the words say.

          (The step's own notation is not written out here, because a slash
          followed by a star ends a JSX comment - the same trap the coin marks
          hit from the other side.) */}
      {state.mode === "every" ? (
        <>
          <Field
            label={t("schedule.everyLabel")}
            keyboard="numeric"
            value={String(state.everyCount)}
            onChange={(v) => set({ everyCount: Math.max(1, Math.round(Number(v) || 1)) })}
          />
          <Choice<EveryUnit>
            value={state.everyUnit}
            onChange={(everyUnit) => set({ everyUnit })}
            options={EVERY_UNITS.map((unit) => ({
              value: unit,
              label: t(`schedule.unit.${unit}`),
            }))}
          />
        </>
      ) : null}

      {/* The time, for both timed modes, on Android's own clock face. It was a
          typed HH:MM box, argued for on the grounds that a dialog costs two
          taps for a value somebody types faster - which is true of a keyboard
          and not of a thumb. jdp: "Felder wo man zb eine uhrzeit einstellen
          kann, soll dieser bekannte radial zeitwähler kommen wenn man
          reintippt." */}
      {state.mode === "daily" || state.mode === "weekly" ? (
        <TimeField label={t("schedule.at")} value={state.time} onChange={(time) => set({ time })} />
      ) : null}

      {/* The days, as seven toggles in a row. Never allowed to reach zero: the
          shared writer falls back to Monday rather than emitting a weekday-less
          expression, which would quietly turn a weekly schedule into a daily
          one at the moment somebody unticked the last day. */}
      {state.mode === "weekly" ? (
        <>
          <AxisLabel>{t("schedule.days")}</AxisLabel>
          <View style={styles.days}>
            {WEEKDAYS.map(({ day, key }) => {
              const on = state.days.includes(day);
              return (
                <DayChip
                  key={key}
                  label={t(`schedule.day.${key}`)}
                  on={on}
                  onPress={() =>
                    set({
                      days: on ? state.days.filter((d) => d !== day) : [...state.days, day],
                    })
                  }
                />
              );
            })}
          </View>
        </>
      ) : null}

      {/* The raw expression, and it STAYS on screen now. It is its own mode
          rather than a fallback, so writing something that happens to match a
          preset no longer throws somebody out of the field they are typing in. */}
      {state.mode === "cron" ? (
        <Field
          label={t("schedule.cron")}
          value={state.cron}
          onChange={(cron) => set({ cron })}
          placeholder="0 * * * *"
        />
      ) : null}
    </View>
  );
}

/** One weekday, as a pill that fills when it is on. The same object a chain
 *  chip in the crypto window is, and for the same reason: a set where several
 *  members can be chosen at once is chips, not a well. */
function DayChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { p, radius, accent, hueAt } = useTheme();
  const fill = hueAt(0) ?? accent;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.day,
        { borderRadius: radius.pill, backgroundColor: on ? fill : p.surface2 },
      ]}
    >
      <Text style={[styles.dayText, { color: on ? contrastOn(fill) : p.textSub }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.sm },
  // The field takes the room and the button takes what it needs, so a long
  // path does not squeeze the way out of the form.
  pickRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-end" },
  pickField: { flex: 1 },
  stack: { gap: space.sm },
  days: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  day: { flexGrow: 1, minWidth: 40, paddingVertical: 7, paddingHorizontal: space.sm, alignItems: "center" },
  dayText: { fontSize: text.dense, fontWeight: "500" },
});
