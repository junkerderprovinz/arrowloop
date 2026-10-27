import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Alert, Dimensions, StyleSheet, Text, View } from "react-native";
import { api, type JobConfig, type Remote } from "../api";
import { Field, LinesField, NumberField, Refusal, TimeField } from "../fields";
import { ChoiceRow } from "../choiceRow";
import { FolderPicker } from "../FolderPicker";
import { JobLive } from "./JobLive";
import { Glyph, ProviderMark } from "../glyphs";
import { useT, type T } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { contrastOn, space, text } from "../theme";
import { useEngineSettings } from "../settings";
import { DEVICE, sideMark } from "../sideRow";
import { sideName, sidePair } from "../sides";
import { animateNext, useMotion } from "../motion";
import { AxisLabel, Body, Button, Card, Choice, Empty, Page, Press, Section, Toggle, usePageScroll, useTheme } from "../ui";
import { WayButton } from "../way";
import { FromGlobal, GlobalSwitch } from "../inherit";
import { amount, type JobLearning } from "../../../web/src/lib/anomalies";
import {
  BRAKE_SETTINGS,
  SETTING_LABEL,
  SYNC_SETTINGS,
  describeOwn,
  describeValue,
  inForce,
  inheritAll,
  owns,
  type Defaults,
  type Inherited,
} from "../../../web/src/lib/follows";
import {
  buildSchedule,
  chooseKind,
  EVERY_UNITS,
  parseSchedule,
  SCHEDULE_MODES,
  WEEKDAYS,
  type EveryUnit,
  type ScheduleMode,
  type ScheduleState,
} from "../../../web/src/lib/schedule.data";

// Creates and edits a job. It edits the configuration file's own fields and
// writes the whole file back through /api/config, as the desktop editor does.

/** How long a field waits before it writes itself, so a typed path is one write. */
const WRITE_AFTER = 700;

/**
 * Every setting a job can take from the global sync settings. The switch is
 * on while the job holds none of them, including those only the desktop
 * edits, so it never claims a job follows when it does not.
 */
const INHERITED: Inherited[] = [...SYNC_SETTINGS, ...BRAKE_SETTINGS];

/** The inherited settings this screen shows, which turning the switch off fills in. */
const SHOWN: Inherited[] = ["direction", "schedule", "quietPeriod", "emptyDirs", "metadata"];

export function JobEdit() {
  // Opening and editing a job share this screen; see App.tsx.
  const route = useRoute<RouteProp<JobsStack, "JobEdit" | "JobDetail">>();
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const { ms } = useMotion();
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
  const sets = Object.keys((engineSettings?.excludeSets as Record<string, string[]> | undefined) ?? {}).sort();

  const [picking, setPicking] = useState<"left" | "right" | null>(null);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  useEffect(() => {
    api.storage().then(
      (list) => setRemotes(list.remotes),
      // Without targets the picker still browses the phone's folders.
      () => setRemotes([]),
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
  const switchRef = useRef<View>(null);
  const nameRef = useRef<View>(null);
  const leftRef = useRef<View>(null);
  const rightRef = useRef<View>(null);
  const scheduleRef = useRef<View>(null);
  const quietRef = useRef<View>(null);
  const excludeRef = useRef<View>(null);
  const refs: Record<Spot, RefObject<View | null>> = {
    name: nameRef,
    left: leftRef,
    right: rightRef,
    schedule: scheduleRef,
    quiet: quietRef,
    exclude: excludeRef,
  };

  // A tap on a value the job takes from the global settings points at the
  // switch, bringing it into view first when it has scrolled away.
  const [nudged, setNudged] = useState(0);
  const nudge = () => {
    switchRef.current?.measureInWindow((_x, y, _w, h) => {
      const away = y < 0 || y + h > Dimensions.get("window").height;
      if (!away) {
        setNudged((n) => n + 1);
        return;
      }
      scroll.reveal(switchRef);
      setTimeout(() => setNudged((n) => n + 1), ms.layout);
    });
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

  const follows = !INHERITED.some((setting) => owns(job, setting));
  // What the job runs with: its own value, or the default's while it follows.
  const shown = (setting: Inherited): JobConfig =>
    owns(job, setting) ? job : { ...job, ...inForce(defaults, setting) };
  const global = (setting: Inherited) => ({
    follows,
    label: describeOwn(shown(setting), setting, t),
    onPress: nudge,
  });

  // Off fills in what the screen shows with the global values, so nothing
  // about the job changes until somebody edits it. On asks first when a value
  // of the job's own would be lost.
  const chooseGlobal = (on: boolean) => {
    if (!on) {
      const shows = editing ? [...SHOWN, "brakePercent" as const, "changePercent" as const] : SHOWN;
      set(Object.assign({}, ...shows.map((setting) => inForce(defaults, setting))) as Partial<JobConfig>, true);
      return;
    }
    const drop = () => set(inheritAll(INHERITED) as Partial<JobConfig>, true);
    const lost = INHERITED.filter(
      (setting) =>
        owns(job, setting) &&
        describeValue(job, setting, t) !== describeValue(inForce(defaults, setting), setting, t),
    );
    if (lost.length === 0) {
      drop();
      return;
    }
    Alert.alert(
      t("defaults.askTitle"),
      t("defaults.askAll", { name: job.name, list: lost.map((setting) => t(SETTING_LABEL[setting])).join(", ") }),
      [
        { text: t("confirm.cancel"), style: "cancel" },
        { text: t("defaults.useDefault"), onPress: drop },
      ],
    );
  };

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
      {editing ? <JobLive name={editing} check={route.params && "check" in route.params ? route.params.check : false} /> : null}

      {/* Before the settings it decides about. It waits for the global
          values, since turning it off copies them into the job. */}
      <View ref={switchRef} collapsable={false}>
        <GlobalSwitch value={follows} onChange={chooseGlobal} disabled={!engineSettings} nudge={nudged} />
      </View>

      <Section title={t("phone.job")} hue={0}>
        <View ref={nameRef} collapsable={false}>
          <Field
            label={t("edit.name")}
            value={job.name}
            onChange={(name) => set({ name })}
            error={reason("name")}
          />
        </View>
      </Section>

      {/* The way files go: the two sides one above the other, and the
          direction between them pointing from the one to the other. The mode
          comes with the direction, so the two follow the global settings
          together. */}
      <View ref={leftRef} collapsable={false}>
        <SideCard
          side={job.left}
          name={sideName(job.left, t)}
          remotes={remotes}
          placeholder="/storage/emulated/0/DCIM"
          error={reason("left")}
          onChange={(left) => set({ left })}
          onPick={() => setPicking("left")}
        />
      </View>
      <FromGlobal {...global("direction")}>
        <WayButton
          value={way}
          upper={upper}
          lower={lower}
          onChange={(direction) =>
            set({ direction, mode: direction === "both" ? "sync" : (shown("direction").mode ?? "sync") }, true)
          }
        />
      </FromGlobal>
      <View ref={rightRef} collapsable={false}>
        <SideCard
          side={job.right}
          name={sideName(job.right, t, "target")}
          remotes={remotes}
          placeholder="nextcloud:Photos"
          error={reason("right")}
          onChange={(right) => set({ right })}
          onPick={() => setPicking("right")}
        />
      </View>

      {/* A watching job owns its schedule, so Live follows the global
          settings with it. No "run at start" switch: the engine restarts with
          the app and after every eviction, so it would run a job several
          times a day. */}
      <Section title={t("edit.schedule")} hue={1}>
        <View ref={scheduleRef} collapsable={false} style={styles.stack}>
          <FromGlobal {...global("schedule")}>
            <Schedule
              label={t("edit.when")}
              value={timing}
              watch={Boolean(shown("schedule").watch)}
              settle={job.watchSettle ?? ""}
              realTime
              onChange={(patch) => set(patch, true)}
            />
          </FromGlobal>
          {reason("schedule") ? <Refusal text={reason("schedule") ?? ""} /> : null}
        </View>
        <View ref={quietRef} collapsable={false}>
          <FromGlobal {...global("quietPeriod")}>
            <QuietField
              value={shown("quietPeriod").quietPeriod ?? ""}
              onChange={(quietPeriod) => set({ quietPeriod })}
              error={reason("quiet")}
            />
          </FromGlobal>
        </View>
      </Section>

      {/* How the two sides are brought together. A two-way job has only one
          mode, so it shows the conflict rule instead. */}
      <Section title={t("edit.cardSync")} hue={2}>
        {way === "both" ? (
          <Toggle
            label={t("edit.newerWins")}
            hint={t("edit.newerWinsHint")}
            value={Boolean(job.newerWins)}
            onChange={(newerWins) => set({ newerWins }, true)}
          />
        ) : (
          <FromGlobal {...global("direction")}>
            {/* Each mode explains itself in its segment. */}
            <ChoiceRow
              label={t("mode.label")}
              bar
              hue={1}
              value={shown("direction").mode ?? "sync"}
              onChange={(mode) => set({ mode }, true)}
              options={[
                { value: "sync", label: t("mode.sync"), hint: t("mode.syncHint") },
                { value: "mirror", label: t("mode.mirror"), hint: t("mode.mirrorHint") },
                { value: "move", label: t("mode.move"), hint: t("mode.moveHint") },
              ]}
            />
          </FromGlobal>
        )}
        <FromGlobal {...global("emptyDirs")}>
          <Toggle
            label={t("edit.emptyDirs")}
            value={Boolean(shown("emptyDirs").emptyDirs)}
            onChange={(emptyDirs) => set({ emptyDirs }, true)}
          />
        </FromGlobal>
        <FromGlobal {...global("metadata")}>
          <Toggle
            label={t("edit.metadata")}
            hint={t("edit.metadataHint")}
            value={Boolean(shown("metadata").metadata)}
            onChange={(metadata) => set({ metadata }, true)}
          />
        </FromGlobal>
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

      {/* A shared list adds its patterns to the job's own. */}
      <Section title={t("edit.exclude")} hue={3}>
        <AxisLabel hint={t("edit.excludeSetsHint")}>{t("edit.excludeSets")}</AxisLabel>
        {sets.length === 0 ? <Body muted>{t("sets.none")}</Body> : null}
        {sets.map((name) => {
          const chosen = job.excludeSets ?? [];
          return (
            <Toggle
              key={name}
              label={name}
              value={chosen.includes(name)}
              onChange={(on) =>
                set({ excludeSets: on ? [...chosen, name] : chosen.filter((each) => each !== name) }, true)
              }
            />
          );
        })}
        <View ref={excludeRef} collapsable={false}>
          <LinesField
            label={t("edit.excludeOwn")}
            hint={t("edit.excludeHint")}
            value={job.exclude ?? []}
            onChange={(list) => set({ exclude: list })}
            placeholder={"*.tmp\n.thumbnails/"}
            error={reason("exclude")}
          />
        </View>
      </Section>

      {/* The brakes hold a run whether or not the anomaly notes are on, so
          they are the job's own setting rather than the Anomalies screen's. */}
      {editing ? (
        <Section title={t("job.brakes")} hint={t("job.brakesHint")} hue={4}>
          {BRAKES.map(({ setting, label, hint }) => (
            <FromGlobal key={setting} {...global(setting)}>
              <NumberField
                label={t(label)}
                hint={t(hint)}
                value={String(shown(setting)[setting] ?? 0)}
                onChange={(v) => {
                  const value = Number(v.replace(/[^\d]/g, ""));
                  if (!Number.isNaN(value)) set({ [setting]: Math.min(100, value) });
                }}
              />
            </FromGlobal>
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
        targets={remotes.map((r) => r.name)}
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
 * One side of a job as a card: what it is, with the phone's glyph or the
 * target's logo as the target picker shows it, then its path and the folder
 * picker. The path stays typed, for a target the picker cannot browse.
 */
function SideCard({
  side,
  name,
  remotes,
  placeholder,
  error,
  onChange,
  onPick,
}: {
  side: string;
  name: string;
  remotes: Remote[];
  placeholder: string;
  error?: string;
  onChange: (next: string) => void;
  onPick: () => void;
}) {
  const { t } = useT();
  const { p, scheme } = useTheme();
  const mark = sideMark(side, remotes);
  return (
    <Card>
      <View style={styles.sideHead}>
        {mark === DEVICE ? (
          <Glyph name="IconPhone" color={p.textSub} size={22} />
        ) : mark ? (
          <ProviderMark name={mark} width={MARK} height={MARK} color={p.textSub} scheme={scheme} />
        ) : null}
        <Text style={[styles.sideName, { color: p.text }]} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <Field
        label={t("edit.folderPath")}
        value={side}
        onChange={onChange}
        placeholder={placeholder}
        error={error}
      />
      <Button
        label={t("pick.title")}
        labelKey="pick.title"
        mark={(ink) => <Glyph name="IconFolder" color={ink} />}
        onPress={onPick}
      />
    </Card>
  );
}

/** The logo's box in a side card's head. */
const MARK = 28;

/**
 * The quiet period as the engine spells it, "30s". The text is kept as typed,
 * since an empty field gives the job back to the global value and would
 * replace what is being typed with it; a job that waits for nothing says 0s.
 */
function QuietField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  const { t } = useT();
  const [typed, setTyped] = useState(value);
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value;
      setTyped(value);
    }
  }, [value]);
  return (
    <Field
      label={t("edit.quietPeriod")}
      hint={t("edit.quietHint")}
      value={typed}
      onChange={(next) => {
        setTyped(next);
        const written = next.trim() || "0s";
        seen.current = written;
        onChange(written);
      }}
      placeholder="30s"
      error={error}
    />
  );
}

/** The job's own brakes, each the global value while the job follows. */
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
type Spot = "name" | "left" | "right" | "schedule" | "quiet" | "exclude";

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
  if (/quietPeriod/i.test(message)) return "quiet";
  if (/exclude/i.test(message)) return "exclude";
  if (/no name/i.test(message)) return "name";
  if (/\bleft\b/i.test(message)) return "left";
  return "right";
}

/** The fields a schedule writes on a job. A default schedule writes only the expression. */
export type SchedulePatch = { schedule: string; watch?: boolean; watchSettle?: string };

/**
 * A schedule over the shared lib/schedule.data.ts model: its kinds as one bar
 * under `label`, then the fields of the chosen kind. An expression the fields
 * cannot say reads back as cron, so it stays editable. Real time belongs to a
 * job, so a default schedule leaves it out.
 */
export function Schedule({
  label,
  value,
  watch = false,
  settle = "",
  realTime = false,
  onChange,
}: {
  label: string;
  value: string;
  watch?: boolean;
  settle?: string;
  realTime?: boolean;
  onChange: (next: SchedulePatch) => void;
}) {
  const { t } = useT();
  const { intensity: motion } = useMotion();
  const derived = parseSchedule(value);

  // The kind is kept in state rather than parsed from the stored value, which
  // cannot express every kind: an empty cron expression reads back as "off",
  // and real time writes the same expression as "every N". It is re-seeded
  // when the value changes from outside.
  const [mode, setMode] = useState<ScheduleMode>(watch ? "live" : derived.mode);
  // The expression as typed, since the stored one is trimmed and a space
  // between two fields would vanish as it is typed.
  const [cron, setCron] = useState(value);
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value;
      setMode(watch ? "live" : parseSchedule(value).mode);
      setCron(value);
    }
  }, [value, watch]);

  const state: ScheduleState = { ...derived, mode };
  const write = (next: SchedulePatch) => {
    seen.current = next.schedule;
    onChange(next);
  };
  const set = (patch: Partial<ScheduleState>) => write({ schedule: buildSchedule({ ...state, ...patch }) });

  const kinds = realTime ? SCHEDULE_MODES : SCHEDULE_MODES.filter((m) => m !== "live");

  const every = (label: string, hint?: string) => (
    <>
      <Field
        label={label}
        hint={hint}
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
  );

  return (
    <View style={styles.stack}>
      <ChoiceRow<ScheduleMode>
        label={label}
        full
        hue={2}
        value={state.mode}
        // Each kind shows different rows, so the change is animated.
        onChange={(next) => {
          animateNext(motion);
          const choice = chooseKind(state, value, settle, next);
          setMode(next);
          if (next === "cron") setCron(choice.state.cron);
          write({
            schedule: choice.schedule,
            ...(realTime ? { watch: choice.watch } : {}),
            ...(choice.settle !== undefined ? { watchSettle: choice.settle } : {}),
          });
        }}
        options={kinds.map((kind) => ({ value: kind, label: t(`schedule.${kind}`) }))}
      />

      {/* The shared writer emits `@every`, which counts from the last run; a
          cron step in the hours column would keep to fixed clock hours. */}
      {state.mode === "every" ? every(t("schedule.everyLabel")) : null}

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

      {state.mode === "daily" || state.mode === "weekly" ? (
        <TimeField label={t("schedule.at")} value={state.time} onChange={(time) => set({ time })} />
      ) : null}

      {state.mode === "live" ? (
        <>
          <Field
            label={t("schedule.settle")}
            hint={t("schedule.settleHint")}
            value={settle}
            onChange={(watchSettle) => write({ schedule: value, watchSettle })}
            placeholder="5s"
          />
          {every(t("schedule.backstop"), t("schedule.backstopHint"))}
        </>
      ) : null}

      {/* Its own kind, so typing an expression that matches a preset does not
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
  sideHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sideName: { flex: 1, fontSize: text.title, fontWeight: "600" },
  stack: { gap: space.sm },
  days: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  day: { flexGrow: 1, minWidth: 40, paddingVertical: 7, paddingHorizontal: space.sm, alignItems: "center" },
  dayText: { fontSize: text.meta, fontWeight: "500" },
});
