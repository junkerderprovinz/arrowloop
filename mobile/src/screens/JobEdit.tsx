import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { api, type JobConfig } from "../api";
import { Field, LinesField, NumberField, Refusal, TimeField } from "../fields";
import { ChoiceRow } from "../choiceRow";
import { FolderPicker } from "../FolderPicker";
import { JobLive } from "./JobLive";
import { Glyph } from "../glyphs";
import { useT, type T } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { contrastOn, space, text } from "../theme";
import { useEngineSettings } from "../settings";
import { sideName, sidePair } from "../sides";
import { animateNext, useMotion } from "../motion";
import { AxisLabel, Body, Button, Choice, Empty, Page, Press, Section, Toggle, usePageScroll, useTheme } from "../ui";
import { WaySwitch } from "../way";
import { Inherits, ScheduleSentence } from "../inherit";
import { amount, type JobLearning } from "../../../web/src/lib/anomalies";
import { inForce, inheritPatch, owns, type Defaults, type Inherited } from "../../../web/src/lib/follows";
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

  const [job, setJob] = useState<JobConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.config().then(
      (c) => {
        const found = editing ? c.jobs.find((j) => j.name === editing) : undefined;
        setJob(
          found
            ? { ...found }
            : {
                // A new job is enabled and sets nothing the global sync
                // settings decide, so it follows them.
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

  // What a job runs with where it follows the global settings.
  const { settings: engineSettings } = useEngineSettings(true);
  const defaults = engineSettings?.defaults as Defaults | undefined;

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
  // The engine's last refusal, read by Save to find the field it names.
  const refusal = useRef("");

  /**
   * Writes the job into a freshly read configuration, so a change made
   * elsewhere in between is not undone. Reports whether it was written. A job
   * the form itself finds wanting is not sent, since the engine would refuse
   * it in English and the form says why in the reader's language.
   */
  const persist = useCallback(
    async (next: JobConfig): Promise<boolean> => {
      const name = next.name.trim();
      if (problemOf(next, t)) {
        setError("");
        return false;
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
        return true;
      } catch (e) {
        refusal.current = (e as Error).message;
        setError(refusal.current);
        return false;
      }
    },
    [t],
  );

  /**
   * Changes a field. A saved job writes itself: `now` at once, for switches
   * and choices; typed fields wait WRITE_AFTER. A new job waits for its Save
   * button, since the engine would start running it on the global schedule as
   * soon as it had a name and both sides.
   */
  const set = useCallback(
    (patch: Partial<JobConfig>, now = false) => {
      setJob((old) => {
        if (!old) return old;
        const next = { ...old, ...patch };
        if (!editing) return next;
        if (pending.current) clearTimeout(pending.current);
        if (now) void persist(next);
        else pending.current = setTimeout(() => void persist(next), WRITE_AFTER);
        return next;
      });
    },
    [persist, editing],
  );

  const [saving, setSaving] = useState(false);
  // A counter rather than a flag, so every refused attempt shakes the button.
  const [refused, setRefused] = useState(0);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  // A new job says what is missing once its Save was refused; a saved job,
  // which writes itself, says so at once, since nothing else would.
  const [tried, setTried] = useState(false);
  const scroll = usePageScroll();
  const nameRef = useRef<View>(null);
  const leftRef = useRef<View>(null);
  const rightRef = useRef<View>(null);
  const scheduleRef = useRef<View>(null);
  const excludeRef = useRef<View>(null);
  const refs: Record<Spot, RefObject<View | null>> = {
    name: nameRef,
    left: leftRef,
    right: rightRef,
    schedule: scheduleRef,
    exclude: excludeRef,
  };

  const remove = () => {
    if (!editing) return;
    const gone = savedAs.current ?? editing;
    Alert.alert(t("edit.removeJob"), t("edit.removeStakes", { name: gone }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        // Not "destructive": GlimStone paints no delete red, dialogs included.
        onPress: async () => {
          // A typed change still waiting to be written would bring the job back.
          if (pending.current) clearTimeout(pending.current);
          try {
            // Read again, so a change made elsewhere since the screen opened
            // is not written back.
            const current = await api.config();
            await api.writeConfig({ ...current, jobs: current.jobs.filter((j) => j.name !== gone) });
            nav.popToTop();
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
    ]);
  };

  if (!job) return <Empty title={t("jobs.historyLoading")} detail={error || undefined} />;

  const [upper, lower] = sidePair(job.left, job.right, t);

  const own = (setting: Inherited) => owns(job, setting);
  // What the job runs with: its own value, or the default's while it follows.
  const shown = (setting: Inherited): JobConfig => (own(setting) ? job : { ...job, ...inForce(defaults, setting) });
  const inherits = (setting: Inherited) => ({
    setting,
    own: own(setting),
    defaults,
    onOverride: () => set(inForce(defaults, setting), true),
    onInherit: () => set(inheritPatch(setting), true),
  });
  const way = shown("direction").direction ?? "both";
  const timing = shown("schedule").schedule ?? "";

  // A refused Save shakes, says why at the field it concerns and scrolls
  // there, since the field may be far above the button.
  const create = async () => {
    setTried(true);
    const found = problemOf(job, t);
    if (found) {
      setRefused((n) => n + 1);
      scroll.reveal(refs[found.spot]);
      return;
    }
    setSaving(true);
    const written = await persist(job);
    setSaving(false);
    if (written) {
      nav.goBack();
      return;
    }
    setRefused((n) => n + 1);
    scroll.reveal(refs[spotOf(refusal.current)]);
  };

  // Where the reason for a refusal stands: the form's own check first, then
  // the engine's answer, placed by what it names.
  const problem = problemOf(job, t);
  const said: { spot: Spot; text: string } | null =
    problem && (editing || tried) ? problem : !problem && error ? { spot: spotOf(error), text: error } : null;
  const reason = (spot: Spot) => (said?.spot === spot ? said.text : undefined);

  return (
    <Page scroll={scroll}>
      {editing ? <JobLive name={editing} /> : null}

      {/* What the job is: its name, its two sides and the way files go
          between them. Each side is labelled after what it is; see sideName.
          The mode comes with the direction, so the two are overridden and
          given back together. */}
      <Section title={t("phone.job")} hue={0}>
        <View ref={nameRef} collapsable={false}>
          <Field
            label={t("edit.name")}
            hint={t("edit.nameHint")}
            value={job.name}
            onChange={(name) => set({ name })}
            error={reason("name")}
          />
        </View>
        <View ref={leftRef} collapsable={false} style={styles.pickRow}>
          <View style={styles.pickField}>
            <Field
              label={sideName(job.left, t)}
              hint={t("edit.sideHint")}
              value={job.left}
              onChange={(left) => set({ left })}
              placeholder="/storage/emulated/0/DCIM"
              error={reason("left")}
            />
          </View>
          <Button
            label={t("pick.title")}
            labelKey="pick.title"
            mark={(ink) => <Glyph name="IconFolder" color={ink} />}
            onPress={() => setPicking("left")}
          />
        </View>
        <Inherits {...inherits("direction")} label={t("direction.label")} hint={t("direction.hint")}>
          <WaySwitch
            value={way}
            upper={upper}
            lower={lower}
            onChange={(direction) => set({ direction, mode: direction === "both" ? "sync" : job.mode }, true)}
          />
        </Inherits>
        <View ref={rightRef} collapsable={false} style={styles.pickRow}>
          <View style={styles.pickField}>
            <Field
              label={sideName(job.right, t, "target")}
              hint={t("edit.sideHint")}
              value={job.right}
              onChange={(right) => set({ right })}
              placeholder="nextcloud:Photos"
              error={reason("right")}
            />
          </View>
          <Button
            label={t("pick.title")}
            labelKey="pick.title"
            mark={(ink) => <Glyph name="IconFolder" color={ink} />}
            onPress={() => setPicking("right")}
          />
        </View>
        {/* Each mode explains itself in its segment. A both-ways job has only
            one, so the name's bubble says why the choice stands still. */}
        <ChoiceRow
          label={t("mode.label")}
          hint={way === "both" ? t("mode.onlyOneWay") : undefined}
          hue={1}
          value={way === "both" ? "sync" : (shown("direction").mode ?? "sync")}
          disabled={!own("direction") || way === "both"}
          onChange={(mode) => set({ mode }, true)}
          options={[
            { value: "sync", label: t("mode.sync"), hint: t("mode.syncHint") },
            { value: "mirror", label: t("mode.mirror"), hint: t("mode.mirrorHint") },
            { value: "move", label: t("mode.move"), hint: t("mode.moveHint") },
          ]}
        />
      </Section>

      {/* When the job runs and what it keeps. A watching job owns its
          schedule, so Live is locked with it while the job follows the
          default. No "run at start" switch: the engine restarts with the app
          and after every eviction, so it would run a job several times a day. */}
      <Section title={t("history.runs")} hue={1}>
        <View ref={scheduleRef} collapsable={false} style={styles.stack}>
          <Inherits {...inherits("schedule")} label={t("edit.schedule")} hint={t("edit.scheduleHint")}>
            <View style={styles.stack}>
              <ScheduleSentence label={t("edit.schedule")} value={timing} watch={Boolean(job.watch)}>
                <Schedule value={timing} onChange={(schedule) => set({ schedule }, true)} />
              </ScheduleSentence>
              <Toggle
                label={t("schedule.live")}
                hint={t("schedule.liveHint")}
                value={Boolean(job.watch)}
                onChange={(watch) => set({ watch }, true)}
              />
            </View>
          </Inherits>
          {reason("schedule") ? <Refusal text={reason("schedule") ?? ""} /> : null}
        </View>
        <Toggle
          label={t("edit.trash")}
          hint={t("edit.trashHint")}
          value={!job.noTrash}
          onChange={(on) => set({ noTrash: !on }, true)}
        />
        {editing && !job.noTrash ? (
          // One under the other, since a side's name needs the full width.
          <View style={styles.stack}>
            <Button
              label={`${t("nav.trash")} · ${upper}`}
              onPress={() => nav.navigate("Trash", { name: editing, side: "left", place: upper })}
            />
            <Button
              label={`${t("nav.trash")} · ${lower}`}
              onPress={() => nav.navigate("Trash", { name: editing, side: "right", place: lower })}
            />
          </View>
        ) : null}
      </Section>

      {/* What crosses over: what is left out, and whether empty folders and
          permissions go along. The last two come from the global sync
          settings until the job overrides them. */}
      <Section title={t("settings.contents")} hue={2}>
        <View ref={excludeRef} collapsable={false}>
          <LinesField
            label={t("edit.exclude")}
            hint={t("edit.excludeHint")}
            value={job.exclude ?? []}
            onChange={(list) => set({ exclude: list })}
            placeholder={"*.tmp\n.thumbnails/"}
            error={reason("exclude")}
          />
        </View>
        {(["emptyDirs", "metadata"] as const).map((setting) => (
          <Inherits key={setting} {...inherits(setting)}>
            <Toggle
              label={t(`edit.${setting}`)}
              hint={t(`edit.${setting}Hint`)}
              value={Boolean(shown(setting)[setting])}
              onChange={(on) => set({ [setting]: on }, true)}
            />
          </Inherits>
        ))}
      </Section>

      {/* The brakes hold a run whether or not the anomaly notes are on, so
          they are the job's own setting rather than the Anomalies screen's. */}
      {editing ? (
        <Section title={t("job.brakes")} hint={t("job.brakesHint")} hue={3}>
          {BRAKES.map(({ setting, label, hint }) => (
            <Inherits key={setting} {...inherits(setting)}>
              <NumberField
                label={t(label)}
                hint={t(hint)}
                value={String(shown(setting)[setting] ?? 0)}
                onChange={(v) => {
                  const value = Number(v.replace(/[^\d]/g, ""));
                  if (!Number.isNaN(value)) set({ [setting]: Math.min(100, value) });
                }}
              />
            </Inherits>
          ))}
        </Section>
      ) : null}
      {editing ? <UsualSection job={editing} /> : null}

      {/* Holding a job is an action on the job card, not a setting here. */}
      {editing ? (
        <View style={styles.actions}>
          <Button label={t("action.delete")} labelKey="action.delete" onPress={remove} />
        </View>
      ) : (
        // The control that goes ahead sits on the right.
        <View style={styles.actions}>
          <Button label={t("confirm.cancel")} onPress={() => nav.goBack()} />
          <Button
            label={t("edit.save")}
            labelKey="edit.save"
            tone="accent"
            busy={saving}
            shake={refused}
            onPress={create}
          />
        </View>
      )}
      <FolderPicker
        visible={picking !== null}
        start={picking === "left" ? job.left : job.right}
        targets={targets}
        onPick={(path) => {
          if (picking) set({ [picking]: path } as Partial<JobConfig>);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Page>
  );
}

/** The job's own brakes, each the global value until it is overridden. */
const BRAKES = [
  { setting: "brakePercent", label: "engine.brakePercent", hint: "engine.brakePercentHint" },
  { setting: "changePercent", label: "engine.changePercent", hint: "engine.changePercentHint" },
] as const;

/** What a run of the job usually does, once enough runs were learned from to say. */
function UsualSection({ job }: { job: string }) {
  const { t } = useT();
  const [learned, setLearned] = useState<JobLearning | null>(null);
  useEffect(() => {
    api.learning().then(
      (all) => setLearned(all.find((l) => l.job === job) ?? null),
      () => setLearned(null),
    );
  }, [job]);
  if (!learned?.usual?.length) return null;
  return (
    <Section title={t("job.usual")} hint={t("job.usualHint")} hue={4}>
      {learned.usual.map((u) => (
        <Body key={u.figure}>
          {t(`job.usual.${u.figure}`, { low: amount(u.figure, u.low, t), high: amount(u.figure, u.high, t) })}
        </Body>
      ))}
    </Section>
  );
}

/** The parts of the form a refusal can point at. */
type Spot = "name" | "left" | "right" | "schedule" | "exclude";

/** What the form itself refuses before anything is sent, and where it says so. */
function problemOf(job: JobConfig, t: T): { spot: Spot; text: string } | null {
  if (!job.name.trim()) return { spot: "name", text: t("phone.needName") };
  if (!job.left.trim()) return { spot: "left", text: t("phone.needSide") };
  if (!job.right.trim()) return { spot: "right", text: t("phone.needSide") };
  // The engine refuses this too, since a configuration can also arrive by
  // backup.
  if (bothSidesOnePlace(job.left, job.right)) return { spot: "right", text: t("edit.sameSides") };
  return null;
}

/**
 * The part of the form an engine refusal is about, read from what it names.
 * Most name a place, so the target side is where the rest is said.
 */
function spotOf(message: string): Spot {
  if (/schedule|watch/i.test(message)) return "schedule";
  if (/exclude/i.test(message)) return "exclude";
  if (/no name/i.test(message)) return "name";
  if (/\bleft\b/i.test(message)) return "left";
  return "right";
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
  // The expression as typed, since the stored one is trimmed and a space
  // between two fields would vanish as it is typed.
  const [cron, setCron] = useState(value);
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value;
      setMode(parseSchedule(value).mode);
      setCron(value);
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
      <ChoiceRow<ScheduleMode>
        label={t("edit.schedule")}
        hue={2}
        value={state.mode}
        // No `live` mode: watching is stored on the job, not in the expression.
        // Each mode shows different rows, so the change is animated.
        onChange={(mode) => {
          animateNext(motion);
          // The field starts from the schedule already set, written out.
          if (mode === "cron") {
            const text = state.mode === "off" ? buildSchedule({ ...state, mode: "daily" }) : value.trim();
            setCron(text);
            set({ mode, cron: text });
            return;
          }
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
            short
            value={String(state.everyCount)}
            onChange={(v) => set({ everyCount: Math.max(1, Math.round(Number(v) || 1)) })}
          />
          <Choice<EveryUnit>
            hue={3}
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
          value={cron}
          onChange={(text) => {
            setCron(text);
            set({ cron: text });
          }}
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
    <Press
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
    </Press>
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
  dayText: { fontSize: text.meta, fontWeight: "500" },
});
