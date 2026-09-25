import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api, type Config, type JobConfig } from "../api";
import { Field, TimeField } from "../fields";
import { FolderPicker } from "../FolderPicker";
import { JobLive } from "./JobLive";
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

// Creates and edits a job. It edits the configuration file's own fields and
// writes the whole file back through /api/config, as the desktop editor does.

/** How long a field waits before it writes itself, so a typed path is one write. */
const WRITE_AFTER = 700;

export function JobEdit() {
  // Opening and editing a job share this screen; see App.tsx.
  const route = useRoute<RouteProp<JobsStack, "JobEdit" | "JobDetail">>();
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const editing = route.params?.name;

  const [config, setConfig] = useState<Config | null>(null);
  const [job, setJob] = useState<JobConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.config().then(
      (c) => {
        setConfig(c);
        const found = editing ? c.jobs.find((j) => j.name === editing) : undefined;
        setJob(
          found
            ? { ...found }
            : {
                // A new job is enabled and sets neither direction nor mode, so
                // it follows the global sync settings.
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

  // The fields the engine's Defaults fill in when a job leaves them unset
  // (`applyTo`). A job follows the global settings while it sets none of them.
  const OWNED = ["direction", "mode", "schedule", "emptyDirs", "metadata"] as const;
  const follows = OWNED.every((key) => job?.[key] === undefined);

  /**
   * Switching off writes the values currently shown, so nothing jumps;
   * switching on clears all five, since an absent field means "follow".
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

  const [picking, setPicking] = useState<"left" | "right" | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  useEffect(() => {
    api.storage().then(
      (list) => setTargets(list.remotes.map((r) => r.name)),
      // Without targets the picker still browses the phone's folders.
      () => setTargets([]),
    );
  }, []);

  /**
   * The name the job is saved under, which a rename looks up and replaces.
   * A ref, since nothing renders from it.
   */
  const savedAs = useRef<string | undefined>(editing);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Writes the job into a freshly read configuration, so a change made
   * elsewhere in between is not undone.
   */
  const persist = useCallback(
    async (next: JobConfig) => {
      const name = next.name.trim();
      if (!name || !next.left.trim() || !next.right.trim()) return;
      // Not sent while both sides name one place: the engine would refuse it
      // with an English error, and the form already says so itself.
      if (bothSidesOnePlace(next.left, next.right)) {
        setError("");
        return;
      }
      try {
        const current = await api.config();
        const jobs = [...current.jobs];
        const at = jobs.findIndex((j) => j.name === savedAs.current);
        const complete: JobConfig = {
          ...next,
          name,
          state: next.state?.trim() || `state/${name}.db`,
        };
        if (at >= 0) jobs[at] = complete;
        else jobs.push(complete);
        await api.writeConfig({ ...current, jobs });
        savedAs.current = name;
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [],
  );

  /**
   * Changes a field and saves it; there is no Save button. `now` writes at
   * once, for switches and choices; typed fields wait WRITE_AFTER.
   */
  const set = useCallback(
    (patch: Partial<JobConfig>, now = false) => {
      setJob((old) => {
        if (!old) return old;
        const next = { ...old, ...patch };
        if (pending.current) clearTimeout(pending.current);
        if (now) void persist(next);
        else pending.current = setTimeout(() => void persist(next), WRITE_AFTER);
        return next;
      });
    },
    [persist],
  );

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  // `persist` silently skips a job without a name and both sides, so the
  // page says what is missing.
  const incomplete = !job?.name.trim() || !job?.left.trim() || !job?.right.trim();

  const remove = () => {
    if (!config || !editing) return;
    Alert.alert(t("edit.removeJob"), t("edit.removeStakes", { name: editing }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        // Not "destructive": GlimStone paints no delete red, dialogs included.
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
      {editing ? <JobLive name={editing} /> : null}

      <Section title={t("edit.name")} hint={t("edit.nameHint")}>
        <Field label={t("edit.name")} value={job.name} onChange={(name) => set({ name })} />
      </Section>

      {/* Each side is labelled after what it is; see sideName. */}
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

      {/* While the job follows the global settings, the options it would
          override are hidden rather than greyed. */}
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
            onChange={(direction) => set({ direction, mode: direction === "both" ? "sync" : job.mode }, true)}
            options={[
              // The spellings the engine's ParseDirection accepts.
              { value: "both", label: t("direction.both") },
              { value: "leftToRight", label: t("direction.toRight") },
              { value: "rightToLeft", label: t("direction.toLeft") },
            ]}
          />
        </Section>
      ) : null}

      {!follows ? (
      <>
      <Section
        title={t("mode.label")}
        // Describes the chosen mode, since two of the three delete files.
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
        {/* Inert on `sync` for a both-ways job, so the card keeps its shape. */}
        <Choice
          value={(job.direction ?? "both") === "both" ? "sync" : (job.mode ?? "sync")}
          disabled={(job.direction ?? "both") === "both"}
          onChange={(mode) => set({ mode }, true)}
          options={[
            { value: "sync", label: t("mode.sync") },
            { value: "mirror", label: t("mode.mirror") },
            { value: "move", label: t("mode.move") },
          ]}
        />
      </Section>

      </>
      ) : null}

      {/* Only the schedule expression is a global default. `watch` is a plain
          bool, where off and unset are the same, so a default could never be
          switched off for one job; it stays visible either way. */}
      <Section title={t("edit.schedule")} hint={t("edit.scheduleHint")}>
        {!follows ? (
          <Schedule value={job.schedule ?? ""} onChange={(schedule) => set({ schedule }, true)} />
        ) : null}
        <Toggle
          label={t("schedule.live")}
          hint={t("schedule.liveHint")}
          value={Boolean(job.watch)}
          onChange={(watch) => set({ watch }, true)}
        />
        {/* No "run at start" switch: the engine restarts with the app and
            after every eviction, so it would run a job several times a day. A
            job that carries the setting keeps it. */}
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

      <Section title={t("edit.trash")} hint={t("edit.trashHint")}>
        <Toggle
          label={t("edit.trash")}
          value={!job.noTrash}
          onChange={(on) => set({ noTrash: !on }, true)}
        />
        {editing && !job.noTrash ? (
          <View style={styles.actions}>
            <Button
              label={`${t("phone.bin")} ${t("side.left")}`}
              onPress={() => nav.navigate("Trash", { name: editing, side: "left" })}
            />
            <Button
              label={`${t("phone.bin")} ${t("side.right")}`}
              onPress={() => nav.navigate("Trash", { name: editing, side: "right" })}
            />
          </View>
        ) : null}
      </Section>

      {/* Holding a job is an action on the job card, not a setting here. */}
      {!follows ? (
        <Section title={t("settings.general")}>
          <Toggle
            label={t("edit.emptyDirs")}
            hint={t("edit.emptyDirsHint")}
            value={Boolean(job.emptyDirs)}
            onChange={(emptyDirs) => set({ emptyDirs }, true)}
          />
          <Toggle
            label={t("edit.metadata")}
            hint={t("edit.metadataHint")}
            value={Boolean(job.metadata)}
            onChange={(metadata) => set({ metadata }, true)}
          />
        </Section>
      ) : null}

      {error ? <Body>{error}</Body> : null}
      {incomplete ? <Body muted>{t("edit.nameHint")}</Body> : null}
      {/* Said by the form in the reader's language; the engine still refuses
          such a job, since a configuration can also arrive by backup. */}
      {bothSidesOnePlace(job.left, job.right) ? <Body muted>{t("edit.sameSides")}</Body> : null}

      {editing ? (
        <View style={styles.actions}>
          <Button label={t("action.delete")} labelKey="action.delete" onPress={remove} />
        </View>
      ) : null}
      <FolderPicker
        visible={picking !== null}
        start={picking === "left" ? job.left : job.right}
        // Targets are offered only for the right side.
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
 * A schedule builder over the shared lib/schedule.data.ts model: off, every N
 * units, daily or on weekdays at a time, or a raw cron expression. An
 * expression the builder does not recognise reads back as cron, so it stays
 * editable.
 */
export function Schedule({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useT();
  const { intensity: motion } = useMotion();
  const derived = parseSchedule(value);

  // The mode is kept in state rather than parsed from the stored value, which
  // cannot express every mode: an empty cron expression reads back as "off".
  // It is re-seeded when the value changes from outside.
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
        // No `live` mode: watching is stored on the job, not in the expression.
        // Each mode shows different rows, so the change is animated.
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

      {/* The shared writer emits `@every`, which counts from the last run; a
          cron step in the hours column would keep to fixed clock hours. */}
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

      {state.mode === "daily" || state.mode === "weekly" ? (
        <TimeField label={t("schedule.at")} value={state.time} onChange={(time) => set({ time })} />
      ) : null}

      {/* With no day ticked, the shared writer falls back to Monday rather than
          writing a daily expression. */}
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

      {/* Its own mode, so typing an expression that matches a preset does not
          switch away from the field. */}
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

/** One weekday as a chip, since several days can be chosen at once. */
function DayChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { p, corners, accent, hueAt } = useTheme();
  const fill = hueAt(0) ?? accent;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.day,
        { ...corners.pill, backgroundColor: on ? fill : p.surface2 },
      ]}
    >
      <Text style={[styles.dayText, { color: on ? contrastOn(fill) : p.textSub }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Reports whether both sides name the same place, mirroring `sameSide` in
 * internal/job/job.go, which is what actually refuses the job. Trailing
 * separators are ignored; case is not folded, since backends differ on it.
 */
export function bothSidesOnePlace(left: string, right: string): boolean {
  const trim = (s: string) => {
    let out = s.trim();
    // A lone separator is a real path, so it keeps its character.
    while (out.length > 1 && (out.endsWith("/") || out.endsWith("\\"))) out = out.slice(0, -1);
    return out;
  };
  const a = trim(left ?? "");
  const b = trim(right ?? "");
  return a !== "" && a === b;
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.sm },
  // The picker button sits under the field, so the path gets the full width.
  pickRow: { gap: space.xs },
  pickField: {},
  stack: { gap: space.sm },
  days: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  day: { flexGrow: 1, minWidth: 40, paddingVertical: 7, paddingHorizontal: space.sm, alignItems: "center" },
  dayText: { fontSize: text.dense, fontWeight: "500" },
});
