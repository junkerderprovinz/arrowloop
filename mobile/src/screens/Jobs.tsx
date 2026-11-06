import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
} from "react-native";
import { api, type Job, type Remote } from "../api";
import { CardMenu, type CardAction } from "../CardMenu";
import { clock } from "../clock";
import { Glyph } from "../glyphs";
import { markForSide } from "../jobMark";
import { groupFindings, shortLine, type Finding } from "../../../web/src/lib/anomalies";
import { jobCopy } from "../../../web/src/lib/jobCopy.data";
import { jobStatus } from "../../../web/src/lib/jobList";
import { byJobOrder, stepJob } from "../../../web/src/lib/jobOrder";
import { mayRun, mayRunAll } from "../fileAccess";
import { useT } from "../i18n";
import { animateNext, useMotion } from "../motion";
import type { Nav, JobsStack } from "../nav";
import { RunProgress, useRunProgress, type Progress } from "../progress";
import { MoveScope, MovingCell, useHoldToMove } from "../reorder";
import { setAppearance, useAppearance, type JobView } from "../settings";
import { sidePair } from "../sides";
import { SideRow, sideMark } from "../sideRow";
import { space, text, TOUCH } from "../theme";
import { useEngineEvents } from "../useEngine";
import { useWaiting } from "../waiting";
import { WayGlyph, wayLabel, wayOf } from "../way";
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  CardHead,
  Choice,
  Empty,
  FAB_ROOM,
  Fab,
  Floating,
  MovingList,
  Press,
  useHue,
  useTheme,
} from "../ui";

/**
 * The job list: one card per job with its sides, its one status and the two
 * buttons a phone needs most, or one row per job in the compact view. A long
 * press lifts a job and the finger carries it to its new place.
 */
export function Jobs() {
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const { p, accent } = useTheme();
  const { intensity: motion } = useMotion();
  const waiting = useWaiting();
  const progress = useRunProgress();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  /** The targets behind the sides, for the cards' logos. */
  const [remotes, setRemotes] = useState<Remote[]>([]);
  useEffect(() => {
    // Refetched on focus, so a target created in another tab gets its logo.
    const stop = nav.addListener("focus", () => {
      api.storage().then((list) => setRemotes(list.remotes), () => {});
    });
    return stop;
  }, [nav]);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { jobView } = useAppearance();
  // A moved job keeps its new place until the engine has the order and the
  // list has been read again.
  const [order, setOrder] = useState<string[] | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const { refresh } = waiting;

  const load = useCallback(async () => {
    try {
      setJobs(await api.jobs());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const stop = nav.addListener("focus", () => {
      void load();
      refresh();
    });
    return stop;
  }, [nav, load, refresh]);

  useEngineEvents(true, load);

  // Animates a job starting or stopping. Keyed on the running set, so a
  // refetch of the same jobs does not animate.
  const roster = (jobs ?? []).filter((j) => j.running).map((j) => j.name).join("\n");
  useEffect(() => {
    animateNext(motion);
  }, [roster, motion]);

  const act = async (job: Job) => {
    setBusy(job.name);
    try {
      if (job.running) await api.stop(job.name);
      else if (await mayRun([job.left, job.right], t)) await api.run(job.name);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Holds or releases a job by rewriting the whole configuration. It is read
   * fresh, since the list on screen carries live state that must not be saved
   * as settings.
   */
  const hold = async (job: Job) => {
    setHolding(job.name);
    try {
      const config = await api.config();
      await api.writeConfig({
        ...config,
        jobs: config.jobs.map((j) => (j.name === job.name ? { ...j, disabled: !job.disabled } : j)),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHolding(null);
    }
  };

  /** Adds a copy of a job without asking, since deleting the copy undoes it. */
  const duplicate = async (job: Job) => {
    try {
      const config = await api.config();
      const source = config.jobs.find((j) => j.name === job.name);
      if (!source) return;
      const copy = jobCopy(source, config.jobs.map((j) => j.name), t("edit.copySuffix"), t("edit.newJob"));
      await api.writeConfig({ ...config, jobs: [...config.jobs, copy] });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = (job: Job) => {
    Alert.alert(t("edit.removeJob"), t("edit.removeStakes", { name: job.name }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        // Not "destructive": GlimStone paints no delete red, dialogs included.
        onPress: async () => {
          try {
            const config = await api.config();
            await api.writeConfig({
              ...config,
              jobs: config.jobs.filter((j) => j.name !== job.name),
            });
            await load();
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
    ]);
  };

  const shown = useMemo(() => {
    if (!jobs || !order) return jobs ?? [];
    const rank = byJobOrder(order);
    return [...jobs].sort((a, b) => rank(a.name, b.name));
  }, [jobs, order]);
  const names = shown.map((j) => j.name);

  const place = async (next: string[]) => {
    setOrder(next);
    try {
      await api.orderJobs(next);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setOrder(null);
  };
  const drag = useHoldToMove(names, (next) => void place(next));

  // TalkBack cannot carry a card, so it moves one place at a time.
  const step = (name: string, e: AccessibilityActionEvent) => {
    const next = stepJob(names, name, e.nativeEvent.actionName === "moveUp" ? -1 : 1);
    if (next.join("\n") === names.join("\n")) return;
    void place(next);
    AccessibilityInfo.announceForAccessibility(t("jobs.moved", { job: name, place: next.indexOf(name) + 1 }));
  };
  const moving = (name: string): Moving => ({
    onLongPress: (e) => drag.lift(name, e),
    onRelease: drag.release,
    accessibilityHint: t("jobs.holdToMove"),
    accessibilityActions: [
      { name: "moveUp", label: t("jobs.moveUp") },
      { name: "moveDown", label: t("jobs.moveDown") },
    ],
    onAccessibilityAction: (e) => step(name, e),
  });

  if (jobs === null) return <Empty title={t("jobs.historyLoading")} detail={error || undefined} />;

  /** Everything the job screen offers besides Run now and the hold, so nothing needs the job opened first. */
  const menuFor = (job: Job): CardAction[] => {
    const [upper, lower] = sidePair(job.left, job.right, t);
    const trash = (side: "left" | "right", place: string) => nav.navigate("Trash", { name: job.name, side, place });
    return [
      // Open is listed although tapping the card does the same, so it can be found.
      { label: t("action.open"), glyph: "IconSync", onPress: () => nav.navigate("JobDetail", { name: job.name }) },
      // Opening and editing reach the same screen but stay two rows, so
      // somebody looking for "edit" finds it.
      { label: t("action.edit"), glyph: "IconPencil", onPress: () => nav.navigate("JobEdit", { name: job.name }) },
      // The copy starts held; see jobCopy.data.ts.
      { label: t("edit.duplicate"), glyph: "IconCopy", onPress: () => void duplicate(job) },
      { label: t("jobs.preview"), glyph: "IconPreview", onPress: () => nav.navigate("Plan", { name: job.name }) },
      // The findings need room, which the job's own screen has.
      { label: t("jobs.check"), glyph: "IconCheck", onPress: () => nav.navigate("JobDetail", { name: job.name, check: true }) },
      { label: `${t("nav.trash")} · ${upper}`, glyph: "IconTrash", onPress: () => trash("left", upper) },
      { label: `${t("nav.trash")} · ${lower}`, glyph: "IconTrash", onPress: () => trash("right", lower) },
      { label: t("action.delete"), glyph: "IconTrash", onPress: () => remove(job) },
    ];
  };

  const findings = waiting.findings ?? [];
  const conflicted = waiting.conflicted ?? [];

  // Held jobs and drafts without both sides stay out. The requests go out
  // together, since the engine limits how many run at once itself.
  const running = jobs.filter((j) => j.running);
  const ready = jobs.filter((j) => !j.disabled && !j.running && j.left && j.right);
  const all = async (work: Promise<unknown>[]) => {
    await Promise.allSettled(work);
    await load();
  };
  const runAll = async () => all((await mayRunAll(ready, t)).map((j) => api.run(j.name)));
  const more = [
    ...(ready.length > 0
      ? [{ label: t("phone.runAll"), glyph: "IconPlay", onPress: () => void runAll() }]
      : []),
    ...(running.length > 0
      ? [{ label: t("phone.stopAll"), glyph: "IconStop", onPress: () => void all(running.map((j) => api.stop(j.name))) }]
      : []),
  ];

  const compact = jobView === "compact";

  const renderJob = ({ item, index }: { item: Job; index: number }) => {
    const waits = {
      held: findings.some((f) => f.held && f.job === item.name),
      noted: findings.some((f) => !f.held && f.job === item.name),
      conflict: conflicted.includes(item.name),
      onConflict: () => nav.getParent()?.navigate("ConflictsTab"),
    };
    const common = {
      job: item,
      index,
      busy: busy === item.name,
      progress: progress[item.name],
      onOpen: () => nav.navigate("JobDetail", { name: item.name }),
      onAct: () => act(item),
      moving: moving(item.name),
      ...waits,
    };
    return (
      <Animated.View style={drag.style(item.name)}>
        {compact ? (
          <JobRow
            {...common}
            onNote={() => nav.navigate("Anomalies", { job: item.name })}
            menu={[
              {
                label: item.disabled ? t("jobs.resume") : t("jobs.pause"),
                glyph: item.disabled ? "IconPlay" : "IconPause",
                onPress: () => void hold(item),
              },
              ...menuFor(item),
            ]}
          />
        ) : (
          <JobCard
            {...common}
            finding={groupFindings(findings.filter((f) => f.job === item.name))[0]?.findings[0]}
            onFinding={() => nav.navigate("Anomalies", { job: item.name })}
            holding={holding === item.name}
            onHold={() => hold(item)}
            menu={menuFor(item)}
            // Either side can be the target; the right is the usual one.
            mark={markForSide(item.right, remotes) ?? markForSide(item.left, remotes)}
            leftMark={sideMark(item.left, remotes)}
            rightMark={sideMark(item.right, remotes)}
          />
        )}
      </Animated.View>
    );
  };

  return (
    <Floating>
      {/* Takes the finger over from a card once it is lifted. */}
      <View style={styles.fill} {...drag.catcher}>
        <MoveScope cells={drag.cells}>
          <MovingList
            style={{ backgroundColor: p.background }}
            data={shown}
            keyExtractor={(j) => j.name}
            CellRendererComponent={MovingCell}
            scrollEnabled={drag.held === null}
            contentContainerStyle={[styles.list, compact && styles.compactList]}
            ListHeaderComponent={
              jobs.length > 0 ? (
                <Choice<JobView>
                  hue={0}
                  value={jobView}
                  onChange={(next) => setAppearance({ jobView: next })}
                  options={[
                    { value: "cards", label: t("jobs.view.cards") },
                    { value: "compact", label: t("jobs.view.compact") },
                  ]}
                />
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={false}
                onRefresh={() => {
                  void load();
                  refresh();
                }}
                tintColor={accent}
              />
            }
            ListEmptyComponent={<Empty title={t("jobs.none")} />}
            ListFooterComponent={error ? <Caption>{error}</Caption> : null}
            renderItem={renderJob}
          />
        </MoveScope>
      </View>
      {/* The screen's rarer actions, quiet beside the one accent. */}
      {more.length > 0 ? (
        <View style={styles.moreSlot}>
          <CardMenu items={more} floating />
        </View>
      ) : null}
      <Fab label={t("edit.add")} labelKey="edit.add" onPress={() => nav.navigate("JobEdit", {})} />
    </Floating>
  );
}

function JobCard({
  job,
  index,
  progress,
  finding,
  onFinding,
  held,
  noted,
  conflict,
  onConflict,
  busy,
  onOpen,
  onAct,
  holding,
  onHold,
  menu,
  mark,
  leftMark,
  rightMark,
  moving,
}: {
  job: Job;
  index: number;
  /** How far the run has got, while the job runs. */
  progress?: Progress;
  /** The loudest thing the engine found about this job, if anything. */
  finding?: Finding;
  onFinding: () => void;
  /** Whether a brake holds the job. */
  held: boolean;
  /** Whether a finding speaks of the job without holding it. */
  noted: boolean;
  /** Whether a conflict of the job waits for an answer. */
  conflict: boolean;
  onConflict: () => void;
  busy: boolean;
  onOpen: () => void;
  onAct: () => void;
  /** Whether the hold is being written right now. */
  holding: boolean;
  onHold: () => void;
  menu: CardAction[];
  /** The target's logo, if the engine could name its product. */
  mark?: string;
  /** The mark in front of each side; see sideMark. */
  leftMark?: string;
  rightMark?: string;
  moving: Moving;
}) {
  const { t } = useT();
  const hue = useHue(index);
  const { p } = useTheme();
  return (
    <Card onPress={onOpen} hue={hue} {...moving}>
      <CardHead mark={mark} title={job.name}>
        <View style={styles.menuSlot}>
          <CardMenu items={menu} />
        </View>
      </CardHead>

      {/* Paths wrap rather than truncate, since the cut part is what tells
          two similar jobs apart. */}
      <SideRow path={job.left} mark={leftMark} />
      <View
        style={styles.way}
        accessible
        accessibilityLabel={wayLabel(wayOf(job.direction), ...sidePair(job.left, job.right, t), t("direction.both"))}
      >
        <WayGlyph way={wayOf(job.direction)} color={p.textSub} flowing={job.running} />
      </View>
      <SideRow path={job.right} mark={rightMark} />

      {/* What the engine found, as one line that leads to the Anomalies
          screen, which holds the files and the answers. */}
      {finding ? (
        <Press onPress={onFinding} accessibilityRole="button" style={styles.finding}>
          <Glyph name="IconAnomalies" color={p.textSub} />
          <Text style={[styles.findingText, { color: p.text }]} numberOfLines={2}>
            {`${t(`anomaly.kind.${finding.kind}`)}: ${shortLine(finding, t, sidePair(job.left, job.right, t))}`}
          </Text>
        </Press>
      ) : null}

      <JobStatus
        job={job}
        held={held}
        noted={noted}
        conflict={conflict}
        onConflict={onConflict}
        onNote={onFinding}
        progress={progress}
        hue={hue}
      />

      {/* Two buttons, since a held job can still be started by hand. A
          running job's button cancels the run rather than pausing, which is
          what the hold button does. The control that goes ahead sits on the
          right. Both are quiet, since the floating button is the screen's one
          accent. */}
      <View style={styles.actions}>
        <Button
          label={job.disabled ? t("jobs.resume") : t("jobs.pause")}
          labelKey={job.disabled ? "jobs.resume" : "jobs.pause"}
          busy={holding}
          onPress={onHold}
        />
        <Button
          label={job.running ? t("jobs.cancelRun") : t("jobs.runNow")}
          labelKey={job.running ? "jobs.cancelRun" : "jobs.runNow"}
          busy={busy}
          onPress={onAct}
        />
      </View>
    </Card>
  );
}

/** What lets a card or a row be lifted and carried, or moved by TalkBack. */
type Moving = {
  onLongPress: (e: GestureResponderEvent) => void;
  onRelease: () => void;
  accessibilityHint: string;
  accessibilityActions: { name: string; label: string }[];
  onAccessibilityAction: (e: AccessibilityActionEvent) => void;
};

/**
 * One job on one row: its colour, its name over its status and last run, and
 * More beside Run now. The hold moves into More. A tap opens the job, as on
 * the card.
 */
function JobRow({
  job,
  index,
  progress,
  held,
  noted,
  conflict,
  onConflict,
  onNote,
  busy,
  onOpen,
  onAct,
  menu,
  moving,
}: {
  job: Job;
  index: number;
  progress?: Progress;
  held: boolean;
  noted: boolean;
  conflict: boolean;
  onConflict: () => void;
  onNote: () => void;
  busy: boolean;
  onOpen: () => void;
  onAct: () => void;
  menu: CardAction[];
  moving: Moving;
}) {
  const { t, lang } = useT();
  const { p } = useTheme();
  const hue = useHue(index);
  const last = job.recent[0];
  // The status of a job that ran fine is already the time of that run.
  const quiet = jobStatus(job, { held, conflict, notes: noted }) === "last";
  return (
    <Card onPress={onOpen} hue={hue} style={styles.row} {...moving}>
      <View style={[styles.mark, { backgroundColor: hue }]} />
      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: p.text }]} numberOfLines={1}>
          {job.name}
        </Text>
        <View style={styles.rowStatus}>
          <JobStatus
            job={job}
            held={held}
            noted={noted}
            conflict={conflict}
            onConflict={onConflict}
            onNote={onNote}
            progress={progress}
            hue={hue}
          />
          {last && !quiet ? <Caption>{t("jobs.lastRun", { when: clock(last.Finished, lang) })}</Caption> : null}
        </View>
      </View>
      <CardMenu items={menu} />
      <Button
        label={job.running ? t("jobs.cancelRun") : t("jobs.runNow")}
        labelKey={job.running ? "jobs.cancelRun" : "jobs.runNow"}
        busy={busy}
        onPress={onAct}
      />
    </Card>
  );
}

/**
 * The job's one status, by the web list's rule. Only a job with nothing waiting
 * gets the quiet green dot, so a held run, a waiting conflict, a note or a run
 * that skipped files is never rounded up to it.
 */
function JobStatus({
  job,
  held,
  noted,
  conflict,
  onConflict,
  onNote,
  progress,
  hue,
}: {
  job: Job;
  held: boolean;
  noted: boolean;
  conflict: boolean;
  onConflict: () => void;
  onNote: () => void;
  progress?: Progress;
  hue: string;
}) {
  const { t, lang } = useT();
  const { p } = useTheme();
  switch (jobStatus(job, { held, conflict, notes: noted })) {
    case "running":
      return (
        <View style={styles.status}>
          <Badge label={t("jobs.state.running")} tone="accent" />
          <RunProgress job={job} at={progress} hue={hue} />
        </View>
      );
    case "held":
      return <Badge label={t("anomaly.heldBadge")} tone="warn" />;
    case "conflict":
      return (
        <Press onPress={onConflict} accessibilityRole="button" style={styles.statusPress}>
          <Badge label={t("status.conflict")} tone="warn" />
        </Press>
      );
    case "warned":
      // A run that skipped files is answered on the job's own screen, which
      // the card around the badge already opens.
      return noted ? (
        <Press onPress={onNote} accessibilityRole="button" style={styles.statusPress}>
          <Badge label={t("status.warned")} tone="warn" />
        </Press>
      ) : (
        <Badge label={t("status.warned")} tone="warn" />
      );
    case "failed":
      return <Badge label={t("status.failed")} tone="fail" />;
    case "paused":
      return <Badge label={t("jobs.state.disabled")} />;
    case "never":
      return <Caption>{t("jobs.historyEmpty")}</Caption>;
    default:
      return (
        <View style={styles.quiet}>
          <View style={[styles.dot, { backgroundColor: p.okSolid }]} />
          <Caption>{t("jobs.lastRun", { when: clock(job.lastSuccess ?? job.recent[0]!.Finished, lang) })}</Caption>
        </View>
      );
  }
}

export function arrow(direction: string): string {
  if (direction === "toRight" || direction === "right") return "→";
  if (direction === "toLeft" || direction === "left") return "←";
  return "↔";
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  menuSlot: { marginStart: "auto" },
  compactList: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  mark: { width: 6, alignSelf: "stretch", minHeight: 24, borderRadius: 3 },
  rowText: { flex: 1, minWidth: 0, gap: space.xs },
  rowName: { fontSize: text.body, fontWeight: "600" },
  rowStatus: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  way: { flexDirection: "row", alignItems: "center", gap: space.sm },
  finding: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  findingText: { flex: 1, fontSize: text.subline, lineHeight: 18 },
  // Room at the end so the floating button does not cover the last card.
  list: { padding: space.lg, gap: space.md, paddingBottom: FAB_ROOM },
  status: { gap: space.sm, alignSelf: "stretch", alignItems: "flex-start" },
  // A touch target of its own, though the badge inside stays small.
  statusPress: { alignSelf: "flex-start", minHeight: TOUCH, justifyContent: "center" },
  quiet: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  // Left of the floating button, at its height.
  moreSlot: { position: "absolute", right: space.lg + TOUCH + space.sm * 2, bottom: space.lg },
});
