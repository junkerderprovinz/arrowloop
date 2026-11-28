import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Alert, Dimensions, StyleSheet, Text, View } from "react-native";
import { api, type JobConfig, type Remote } from "../api";
import { Field, LinesField, NumberField, Refusal, TimeField } from "../fields";
import { ChoiceRow, Dropdown } from "../choiceRow";
import { FolderPicker } from "../FolderPicker";
import { JobLive } from "./JobLive";
import { duplicateJob } from "./Jobs";
import { CardMenu } from "../CardMenu";
import { jobMenu } from "../jobMenu";
import { brandTile, Glyph, ProviderMark } from "../glyphs";
import { AccessNotice, tellAfterSaving, useFileAccess } from "../fileAccess";
import { useT, type T } from "../i18n";
import type { JobsStack, Nav } from "../nav";
import { contrastOn, space, text } from "../theme";
import { useEngineSettings } from "../settings";
import { useReadAgain } from "../useEngine";
import { DEVICE, sideMark } from "../sideRow";
import { remoteOf, sideName, sidePair } from "../sides";
import { isAccount } from "../space";
import { animateNext, useMotion } from "../motion";
import { durationWritten, spotOf, type Spot } from "../jobSpot";
import { rootWritten } from "../rootTarget";
import { vpnChoiceShown, vpnOptions } from "../vpn";
import {
  AxisLabel,
  Badge,
  Caption,
  Body,
  Button,
  Card,
  Choice,
  Empty,
  Page,
  PickRow,
  Press,
  ReadmeButton,
  ReadmeRow,
  Section,
  Sheet,
  Toggle,
  usePageScroll,
  useTheme,
} from "../ui";
import { WayButton } from "../way";
import { FromGlobal, GlobalSwitch } from "../inherit";
import { amount, type JobLearning } from "../../../web/src/lib/anomalies";
import { addList, jobsUsing, offered, pickSet, takesNothing, type Way } from "../../../web/src/lib/sharedLists";
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
import { phoneFolder } from "../../../web/src/lib/side.data";
import { overNetwork } from "../../../web/src/lib/localTarget";
import { vpnChoiceNote, type VpnState } from "../../../web/src/lib/vpn";
import { capitalized } from "../../../web/src/lib/capitalized";
import {
  MAX_MIN_AGE,
  MIN_AGE_PRESETS,
  minAgeChoice,
  minAgeDays,
  type MinAgeChoice,
} from "../../../web/src/lib/minAge.data";
import { targetLabel } from "../../../web/src/lib/targetLabels";

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
const SHOWN: Inherited[] = ["direction", "schedule", "quietPeriod", "modWindow", "emptyDirs", "metadata"];

export function JobEdit() {
  // Opening and editing a job share this screen; see App.tsx.
  const route = useRoute<RouteProp<JobsStack, "JobEdit" | "JobDetail">>();
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const { ms } = useMotion();
  const editing = route.params?.name;

  const [job, setJob] = useState<JobConfig | null>(null);
  const [jobs, setJobs] = useState<JobConfig[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.config().then(
      (c) => {
        setJobs(c.jobs);
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
  const { settings: engineSettings, reload: reloadSettings } = useEngineSettings(true);
  const defaults = engineSettings?.defaults as Defaults | undefined;
  const lists = (engineSettings?.excludeSets as Record<string, string[]> | undefined) ?? {};
  const emptySets = Object.keys(lists).filter((name) => lists[name]!.length === 0);
  const manageLists = () => nav.getParent()?.navigate("MoreTab", { screen: "Sync" });

  // Read again on every visit, so a target connected under More while the
  // form stayed open is there to choose. Without targets a side can still be
  // a folder on the phone.
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const readTargets = useCallback(() => {
    api.storage().then(
      (list) => setRemotes(list.remotes),
      () => {},
    );
  }, []);
  useEffect(readTargets, [readTargets]);
  useReadAgain(readTargets, false);

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
      if (problemOf(next, remotes, t)) {
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
    [t, remotes],
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
        else
          pending.current = setTimeout(() => {
            pending.current = null;
            void persist(next);
          }, WRITE_AFTER);
        return next;
      });
    },
    [persist, editing],
  );

  // A shared list may have been edited or removed behind Manage lists, so a
  // saved job reads itself and the lists again when it comes back into view.
  // An edit still waiting to be written is kept.
  useFocusEffect(
    useCallback(() => {
      reloadSettings();
      if (!editing) return;
      api.config().then(
        (c) => {
          setJobs(c.jobs);
          const found = c.jobs.find((j) => j.name === (savedAs.current ?? editing));
          if (found && !pending.current) setJob({ ...found });
        },
        () => {},
      );
    }, [editing, reloadSettings]),
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
  const liveRef = useRef<View>(null);
  // Counts the checks asked for, starting at one when the job list asked for it.
  const [checks, setChecks] = useState(route.params && "check" in route.params && route.params.check ? 1 : 0);
  const switchRef = useRef<View>(null);
  const nameRef = useRef<View>(null);
  const leftRef = useRef<View>(null);
  const rightRef = useRef<View>(null);
  const scheduleRef = useRef<View>(null);
  const quietRef = useRef<View>(null);
  const modWindowRef = useRef<View>(null);
  const excludeRef = useRef<View>(null);
  const refs: Record<Spot, RefObject<View | null>> = {
    name: nameRef,
    left: leftRef,
    right: rightRef,
    schedule: scheduleRef,
    quiet: quietRef,
    modWindow: modWindowRef,
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

  // A job not saved yet shows the menu too, every action disabled, so its
  // place is known before it can work.
  const saved = editing ? (savedAs.current ?? editing) : undefined;
  const menu = jobMenu(
    t,
    [upper, lower],
    saved
      ? {
          duplicate: () =>
            void duplicateJob(saved, t).then(
              (copy) => copy && nav.push("JobDetail", { name: copy }),
              (e: Error) => setError(e.message),
            ),
          preview: () => nav.navigate("Plan", { name: saved }),
          check: () => {
            scroll.reveal(liveRef);
            setChecks((n) => n + 1);
          },
          dupes: () => nav.navigate("Dupes", { name: saved, places: [upper, lower] }),
          trash: (side, place) => nav.navigate("Trash", { name: saved, side, place }),
          remove,
        }
      : null,
    "screen",
  );

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
    const found = problemOf(job, remotes, t);
    if (found) {
      setRefused((n) => n + 1);
      scroll.reveal(refs[found.spot]);
      return;
    }
    setSaving(true);
    const written = await persist(job);
    setSaving(false);
    if (written) {
      await tellAfterSaving([job.left, job.right], t);
      nav.goBack();
      return;
    }
    setRefused((n) => n + 1);
    scroll.reveal(refs[spotOf(refusal.current)]);
  };

  // Where the reason for a refusal stands: the form's own check first, then
  // the engine's answer, placed by what it names.
  const problem = problemOf(job, remotes, t);
  const said: { spot: Spot; text: string } | null =
    problem && (editing || tried) ? problem : !problem && error ? { spot: spotOf(error), text: error } : null;
  const reason = (spot: Spot) => (said?.spot === spot ? said.text : undefined);

  return (
    <Page scroll={scroll}>
      <View style={styles.top}>
        <CardMenu items={menu} note={saved ? undefined : t("job.saveFirst")} />
      </View>

      {saved ? (
        <View ref={liveRef} collapsable={false}>
          <JobLive name={saved} checks={checks} />
        </View>
      ) : null}

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
          startOnPhone
          error={reason("left")}
          onChange={(left) => set({ left })}
        />
      </View>
      <FromGlobal {...global("direction")}>
        <WayButton
          value={way}
          upper={upper}
          lower={lower}
          // A two-way job neither mirrors, moves nor waits for a file to age.
          onChange={(direction) =>
            set(
              direction === "both"
                ? { direction, mode: "sync", minAgeDays: undefined }
                : { direction, mode: shown("direction").mode ?? "sync" },
              true,
            )
          }
        />
      </FromGlobal>
      <View ref={rightRef} collapsable={false}>
        <SideCard
          side={job.right}
          name={sideName(job.right, t, "target")}
          remotes={remotes}
          startOnPhone={false}
          error={reason("right")}
          onChange={(right) => set({ right })}
        />
      </View>

      <ConnectionSection
        value={typeof job.vpn === "string" ? job.vpn : ""}
        network={acrossNetwork(job.left, remotes) || acrossNetwork(job.right, remotes)}
        onChange={(vpn) => set({ vpn: vpn || undefined }, true)}
      />

      {/* A watching job owns its schedule, so Live follows the global
          settings with it. */}
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
            <DurationField
              label={t("edit.quietPeriod")}
              hint={t("edit.quietHint")}
              value={shown("quietPeriod").quietPeriod ?? ""}
              onChange={(quietPeriod) => set({ quietPeriod })}
              placeholder="30s"
              error={reason("quiet")}
            />
          </FromGlobal>
        </View>
        {/* No choice for the program start: the wake-ups run whatever is due,
            and a job's runAtStart from another machine is saved back as it
            came. */}
        <Body muted>{t("edit.atStartPhone")}</Body>
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
          <>
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
            <MinAgeField value={job.minAgeDays} onChange={(days, now) => set({ minAgeDays: days }, now)} />
          </>
        )}
        <View ref={modWindowRef} collapsable={false}>
          <FromGlobal {...global("modWindow")}>
            <DurationField
              label={t("engine.modWindow")}
              hint={t("engine.modWindowHint")}
              value={shown("modWindow").modWindow ?? ""}
              onChange={(modWindow) => set({ modWindow })}
              placeholder="1s"
              error={reason("modWindow")}
            />
          </FromGlobal>
        </View>
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
              glyph="IconTrash"
              onPress={() => nav.navigate("Trash", { name: editing, side: "left", place: upper })}
            />
            <Button
              label={`${t("nav.trash")} · ${lower}`}
              glyph="IconTrash"
              onPress={() => nav.navigate("Trash", { name: editing, side: "right", place: lower })}
            />
          </View>
        ) : null}
      </Section>

      <Section title={t("edit.inclusions")} hue={3}>
        <AxisLabel hint={t("edit.includeSetsHint")}>{t("edit.excludeSets")}</AxisLabel>
        <SharedListPicker job={job} lists={lists} jobs={jobs} way="include" set={set} onLists={reloadSettings} onManage={manageLists} />
        {takesNothing(job, emptySets) ? <TakesNothing /> : null}
        <LinesField
          label={t("edit.ownInclude")}
          hint={t("edit.includeHint")}
          value={job.include ?? []}
          onChange={(list) => set({ include: list })}
          placeholder={"*.jpg\nDCIM/**"}
        />
      </Section>

      {/* A shared list adds its patterns to the job's own. */}
      <Section title={t("edit.exclude")} hue={3}>
        <AxisLabel hint={t("edit.excludeSetsHint")}>{t("edit.excludeSets")}</AxisLabel>
        <SharedListPicker job={job} lists={lists} jobs={jobs} way="exclude" set={set} onLists={reloadSettings} onManage={manageLists} />
        <View ref={excludeRef} collapsable={false}>
          <LinesField
            label={t("edit.ownExclude")}
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
          <Button label={t("confirm.cancel")} labelKey="confirm.cancel" onPress={() => nav.goBack()} />
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
    </Page>
  );
}

/**
 * One side of a job as a card: what it is, with the phone's glyph or the
 * target's logo as the target picker shows it, then where it lives, on this
 * phone or on a target, and the folder there. The folder stays typed, for a
 * target the picker cannot browse. The job keeps the side as the desktop
 * writes it, a path on the phone or `target:path`.
 */
function SideCard({
  side,
  name,
  remotes,
  startOnPhone,
  error,
  onChange,
}: {
  side: string;
  name: string;
  remotes: Remote[];
  /** Where an empty side starts out, rather than with nothing chosen. */
  startOnPhone: boolean;
  error?: string;
  onChange: (next: string) => void;
}) {
  const { t } = useT();
  const { p, scheme, accent, accentContrast } = useTheme();
  const mark = sideMark(side, remotes);
  const access = useFileAccess();
  const [picking, setPicking] = useState(false);
  // A folder typed on the phone that names no target or does not start at
  // the root, kept to be shown with the reason rather than written as a side
  // that would point somewhere else.
  const [badFolder, setBadFolder] = useState<{ typed: string; why: string } | null>(null);

  // Kept apart from the side itself, since a side on the phone with no folder
  // yet is as empty as one that is nowhere.
  const [where, setWhere] = useState<string | null>(() => placeOf(side) ?? (startOnPhone ? PHONE : null));
  useEffect(() => {
    const place = placeOf(side);
    if (place !== undefined) setWhere(place);
  }, [side]);

  const inTarget = where !== null && where !== PHONE;
  const folder = inTarget ? side.slice(where.length + 1) : side;
  const choose = (next: string) => {
    if (next === where) return;
    setBadFolder(null);
    setWhere(next);
    onChange(next === PHONE ? "" : `${next}:`);
  };

  // A target the configuration names but the engine no longer has is still
  // shown, so the side does not read as nowhere.
  const places = remotes.map((r) => r.name);
  if (inTarget && !places.includes(where)) places.push(where);

  const phoneTile = { color: accent, ink: accentContrast };
  const option = (place: string) => {
    if (place === PHONE) {
      return (
        <ReadmeButton
          key="phone"
          label={t("phone.thisPhone")}
          tile={phoneTile}
          chosen={where === PHONE}
          mark={(lit, ink) => <Glyph name="IconPhone" color={lit ? ink : p.textSub} size={22} />}
          onPress={() => choose(PHONE)}
        />
      );
    }
    const logo = remotes.find((r) => r.name === place)?.mark;
    const tile = brandTile(logo) ?? phoneTile;
    return (
      <ReadmeButton
        key={place}
        label={targetLabel(place)}
        tile={tile}
        chosen={where === place}
        mark={(lit, ink) =>
          logo ? (
            <ProviderMark
              name={logo}
              width={MARK_W}
              height={MARK_H}
              color={lit ? ink : p.textSub}
              scheme={scheme}
              lit={lit ? { ink, cut: tile.color } : undefined}
            />
          ) : (
            <Glyph name="IconTabStorage" color={lit ? ink : p.textSub} size={22} />
          )
        }
        onPress={() => choose(place)}
      />
    );
  };

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
      <AxisLabel hint={t("side.whereHint")}>{t("side.where")}</AxisLabel>
      <ReadmeRow>{[PHONE, ...places].map(option)}</ReadmeRow>
      {!startOnPhone && !remotes.some(offPhone) ? <Body muted>{t("side.noTargets")}</Body> : null}
      {where === null ? (
        error ? <Refusal text={error} /> : null
      ) : (
        <>
          {where === PHONE && access === false ? <AccessNotice /> : null}
          <Field
            label={inTarget ? t("side.inTarget", { name: targetLabel(where) }) : t("edit.folderPath")}
            value={badFolder?.typed ?? folder}
            onChange={(typed) => {
              if (inTarget) return onChange(`${where}:${typed}`);
              const read = phoneFolder(typed, places);
              if ("side" in read) {
                setBadFolder(null);
                return onChange(read.side);
              }
              const why = "stray" in read ? t("side.noSuchTarget", { name: read.stray }) : t("side.notAbsolute");
              setBadFolder({ typed, why });
              onChange("");
            }}
            placeholder={inTarget ? "Photos" : "/storage/emulated/0/DCIM"}
            error={badFolder?.why ?? error}
          />
          <Button
            label={t("pick.title")}
            labelKey="pick.title"
            mark={(ink) => <Glyph name="IconFolder" color={ink} />}
            onPress={() => setPicking(true)}
          />
        </>
      )}
      <FolderPicker
        visible={picking}
        start={side}
        within={inTarget ? `${where}:` : ""}
        onPick={(path) => {
          setBadFolder(null);
          onChange(path);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Card>
  );
}

/** The phone among the places a side can live, beside the targets by their names. */
const PHONE = "";

/** Where a side lives: the phone, a target's name, or undefined for an empty side. */
function placeOf(side: string): string | undefined {
  if (!side) return undefined;
  return remoteOf(side) ?? PHONE;
}

/** Whether a target leads off the phone. Apps and Android/data are served on the phone's own loopback. */
function offPhone(remote: Remote): boolean {
  return isAccount(remote) && !onLoopback(remote);
}

function onLoopback(remote: Remote): boolean {
  return remote.settings.find((s) => s.key === "host")?.value === "127.0.0.1";
}

/**
 * Whether a side reaches across the network, as the web decides it for the
 * choice of VPN, leaving out what the phone serves itself on loopback.
 */
function acrossNetwork(side: string, remotes: Remote[]): boolean {
  if (!overNetwork(side, remotes)) return false;
  const target = remotes.find((r) => r.name === remoteOf(side));
  return !target || !onLoopback(target);
}

/**
 * The VPN of the settings the job's runs go through, or none, on an engine
 * that has VPNs and for a job with a side across the network, since folders
 * on the phone never touch one. A job that names a VPN where it does nothing,
 * or one that is gone, as a job brought over from another machine, keeps the
 * choice, so it can be set to none. The list stands under its name across the
 * card, so a provider's name and its place show in full.
 */
function ConnectionSection({
  value,
  network,
  onChange,
}: {
  value: string;
  network: boolean;
  onChange: (next: string) => void;
}) {
  const { t } = useT();
  const { p } = useTheme();
  const [vpn, setVpn] = useState<{ offered: boolean; state: VpnState | null } | null>(null);
  // Read on every visit, so a VPN just set up in Settings is there to choose.
  useFocusEffect(
    useCallback(() => {
      api
        .capabilities()
        .then(async (c) => setVpn(c.vpn ? { offered: true, state: await api.vpn() } : { offered: false, state: null }))
        .catch(() => setVpn(null));
    }, []),
  );
  if (!vpn || !vpnChoiceShown(vpn.offered, value, network)) return null;
  const note = vpnChoiceNote(vpn.offered, vpn.state?.tunnels ?? [], value);
  return (
    <Section title={t("edit.connection")} hue={5}>
      <AxisLabel hint={t("edit.vpnHint")}>{t("edit.vpn")}</AxisLabel>
      <Dropdown wide label={t("edit.vpn")} value={value} options={vpnOptions(vpn.state, t)} onChange={onChange} />
      {note ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.note, { color: note.fails ? p.warnInk : p.textSub }]}>{t(note.said)}</Text>
        </View>
      ) : null}
    </Section>
  );
}

/**
 * The shared lists for one side of a job: the picked ones as tags and a sheet
 * to pick them in, so twenty lists still fit. A list the other side holds is
 * not offered, since a list both included and excluded takes nothing it matches.
 */
function SharedListPicker({
  job,
  lists,
  jobs,
  way,
  set,
  onLists,
  onManage,
}: {
  job: JobConfig;
  lists: Record<string, string[]>;
  /** Every job, for how many an edit to a list changes. */
  jobs: JobConfig[];
  way: Way;
  set: (patch: Partial<JobConfig>, now?: boolean) => void;
  onLists: () => void;
  onManage: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const chosen = (way === "include" ? job.includeSets : job.excludeSets) ?? [];
  const save = async (next: Record<string, string[]>) => {
    try {
      await api.writeSettings({ excludeSets: next });
      setRefused(null);
      onLists();
      return true;
    } catch (e) {
      setRefused((e as Error).message);
      return false;
    }
  };
  const create = async () => {
    const next = addList(lists, naming ?? "");
    if (!next) return;
    const name = (naming ?? "").trim();
    if (await save(next)) {
      setNaming(null);
      set(pickSet(job, name, way, true), true);
    }
  };
  return (
    <>
      {chosen.length > 0 ? (
        <View style={styles.tags}>
          {chosen.map((name) => (
            <Badge key={name} label={name} />
          ))}
        </View>
      ) : null}
      {chosen.map((name) => (
        <ListPatterns
          key={name}
          name={name}
          patterns={lists[name] ?? []}
          jobs={jobsUsing(jobs, name, job)}
          onSave={(patterns) => save({ ...lists, [name]: patterns })}
        />
      ))}
      {refused ? <Refusal text={refused} /> : null}
      <View style={[styles.end, styles.buttons]}>
        <Button label={t("sets.manage")} labelKey="sets.manage" glyph="IconGear" wide={false} onPress={onManage} />
        <Button label={t("edit.pickLists")} glyph="IconPencil" wide={false} onPress={() => setOpen(true)} />
      </View>
      <Sheet open={open} title={way === "include" ? t("edit.inclusions") : t("edit.exclude")} onClose={() => setOpen(false)}>
        {offered(Object.keys(lists).sort(), job, way).map((name) => {
          const on = chosen.includes(name);
          return (
            <PickRow key={name} on={on} label={name} onPress={() => set(pickSet(job, name, way, !on), true)}>
              <Body>{name}</Body>
            </PickRow>
          );
        })}
        {naming === null ? (
          <Button label={t("sets.newList")} labelKey="sets.newList" glyph="IconAdd" onPress={() => setNaming("")} />
        ) : (
          <View style={styles.stack}>
            <Field label={t("sets.newName")} value={naming} onChange={setNaming} />
            <View style={styles.end}>
              <Button
                label={t("sets.add")}
                labelKey="sets.add"
                glyph="IconAdd"
                wide={false}
                disabled={!addList(lists, naming)}
                onPress={() => void create()}
              />
            </View>
          </View>
        )}
      </Sheet>
    </>
  );
}

/**
 * A picked list's patterns, editable where the job is edited. Saving changes
 * the shared list, so every job that uses it changes too, and the line above
 * Save says how many before it happens.
 */
function ListPatterns({
  name,
  patterns,
  jobs,
  onSave,
}: {
  name: string;
  patterns: string[];
  jobs: number;
  onSave: (patterns: string[]) => Promise<boolean>;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<string[] | null>(null);
  const edited = draft !== null && draft.join("\n") !== patterns.join("\n");
  return (
    <View style={styles.stack}>
      <LinesField label={name} value={draft ?? patterns} onChange={setDraft} />
      {edited ? (
        <>
          <Caption>{t("sets.usedBy", { count: jobs })}</Caption>
          <View style={styles.end}>
            <Button
              label={t("sets.saveList")}
              labelKey="sets.saveList"
              wide={false}
              onPress={() => void onSave(draft!).then((ok) => ok && setDraft(null))}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Under the included lists when all of them are empty, so the job takes nothing. */
function TakesNothing() {
  const { t } = useT();
  const { p } = useTheme();
  return (
    <View accessibilityLiveRegion="polite">
      <Text style={[styles.note, { color: p.warnInk }]}>{t("edit.includesNothing")}</Text>
    </View>
  );
}

/** The README's mark box, as the target picker draws it. */
const MARK_W = 32;
const MARK_H = 25;

/** The logo's box in a side card's head. */
const MARK = 28;

/**
 * A duration of the job's own as the engine spells it, "30s", such as the
 * quiet period. The text is kept as typed, since what is written for an empty
 * field differs from it (see durationWritten).
 */
function DurationField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  error?: string;
}) {
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
      label={label}
      hint={hint}
      value={typed}
      onChange={(next) => {
        setTyped(next);
        const written = durationWritten(next);
        seen.current = written;
        onChange(written);
      }}
      placeholder={placeholder}
      error={error}
    />
  );
}

/**
 * How old a file has to be before a one-way job sends it. Six choices do not
 * fit beside the name on a phone, so the row falls back to its dropdown, and a
 * typed age gets a field of its own under it.
 */
function MinAgeField({
  value,
  onChange,
}: {
  value?: number;
  /** `now` for a choice, as every choice on this screen writes at once. A typed number waits. */
  onChange: (days: number | undefined, now: boolean) => void;
}) {
  const { t, lang } = useT();
  const [custom, setCustom] = useState(() => minAgeChoice(value, false) === "custom");
  const choice = minAgeChoice(value, custom);
  return (
    <View style={styles.stack}>
      <ChoiceRow<MinAgeChoice>
        label={t("edit.minAge")}
        hint={t("edit.minAgeHint")}
        hue={2}
        value={choice}
        onChange={(next) => {
          setCustom(next === "custom");
          onChange(minAgeDays(next, value ?? 0), true);
        }}
        options={[
          { value: "off", label: t("edit.minAge.off") },
          ...MIN_AGE_PRESETS.map((days) => ({
            value: String(days) as MinAgeChoice,
            label: t("edit.minAge.days", { days }),
          })),
          { value: "custom", label: t("edit.minAge.custom") },
        ]}
      />
      {choice === "custom" ? (
        <NumberField
          label={capitalized(t("edit.minAgeUnit"), lang)}
          value={String(value ?? "")}
          onChange={(typed) => {
            const days = Math.min(MAX_MIN_AGE, Number(typed.replace(/[^\d]/g, "")));
            if (days > 0) onChange(days, false);
          }}
        />
      ) : null}
    </View>
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

/** What the form itself refuses before anything is sent, and where it says so. */
function problemOf(job: JobConfig, remotes: Remote[], t: T): { spot: Spot; text: string } | null {
  if (!job.name.trim()) return { spot: "name", text: t("phone.needName") };
  if (!job.left.trim()) return { spot: "left", text: t("phone.needSide") };
  if (!job.right.trim()) return { spot: "right", text: t("phone.needSide") };
  // The engine refuses these too, since a configuration can also arrive by
  // backup.
  if (bothSidesOnePlace(job.left, job.right)) return { spot: "right", text: t("edit.sameSides") };
  const readOnly = rootWritten(job, remotes);
  if (readOnly) return { spot: readOnly, text: t("edit.rootReadOnly") };
  return null;
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
      <NumberField
        label={label}
        hint={hint}
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
  top: { flexDirection: "row", justifyContent: "flex-end" },
  sideHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sideName: { flex: 1, fontSize: text.title, fontWeight: "600" },
  stack: { gap: space.sm },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  buttons: { gap: space.sm, flexWrap: "wrap" },
  end: { flexDirection: "row", justifyContent: "flex-end" },
  note: { fontSize: text.subline },
  days: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  day: { flexGrow: 1, minWidth: 40, paddingVertical: 7, paddingHorizontal: space.sm, alignItems: "center" },
  dayText: { fontSize: text.meta, fontWeight: "500" },
});
