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
import { api, type Job, type Remote, type Run } from "../api";
import { CardMenu, type CardEntry } from "../CardMenu";
import { jobMenu } from "../jobMenu";
import { clock } from "../clock";
import { GLYPH, Glyph } from "../glyphs";
import { markForSide } from "../jobMark";
import { groupFindings, shortLine, type Finding } from "../../../web/src/lib/anomalies";
import { failureLine } from "../../../web/src/lib/failure";
import { jobCopy } from "../../../web/src/lib/jobCopy.data";
import { jobStatus } from "../../../web/src/lib/jobList";
import { byJobOrder, stepJob } from "../../../web/src/lib/jobOrder";
import { mayRun, mayRunAll } from "../fileAccess";
import { barFit, jobsBar, type BarButton } from "../jobsBar";
import { useT, type T } from "../i18n";
import { animateNext, useMotion } from "../motion";
import type { Nav, JobsStack } from "../nav";
import { RunProgress, useRunProgress, type Progress } from "../progress";
import { MoveScope, MovingCell, useHoldToMove } from "../reorder";
import { useFrame } from "../frame";
import { floatingInset } from "../layout";
import { useAppearance, useEngineSettings } from "../settings";
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
  Empty,
  FAB_ROOM,
  Floating,
  MovingList,
  Press,
  useHue,
  useSideRoom,
  useTheme,
} from "../ui";

/**
 * Adds a copy of a job without asking, since deleting the copy undoes it, and
 * returns the copy's name. The copy starts held; see jobCopy.data.ts.
 */
export async function duplicateJob(name: string, t: T): Promise<string | undefined> {
  const config = await api.config();
  const source = config.jobs.find((j) => j.name === name);
  if (!source) return undefined;
  const copy = jobCopy(source, config.jobs.map((j) => j.name), t("edit.copySuffix"), t("edit.newJob"));
  await api.writeConfig({ ...config, jobs: [...config.jobs, copy] });
  return copy.name;
}

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
  const engine = useEngineSettings(true);
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

  const duplicate = async (job: Job) => {
    try {
      await duplicateJob(job.name, t);
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
  const menuFor = (job: Job): CardEntry[] => {
    const places = sidePair(job.left, job.right, t);
    return jobMenu(
      t,
      places,
      {
        open: () => nav.navigate("JobDetail", { name: job.name }),
        edit: () => nav.navigate("JobEdit", { name: job.name }),
        duplicate: () => void duplicate(job),
        preview: () => nav.navigate("Plan", { name: job.name }),
        // The findings need room, which the job's own screen has.
        check: () => nav.navigate("JobDetail", { name: job.name, check: true }),
        dupes: () => nav.navigate("Dupes", { name: job.name, places }),
        trash: (side, place) => nav.navigate("Trash", { name: job.name, side, place }),
        remove: () => remove(job),
      },
      "card",
    );
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
  const paused = !!engine.settings?.pauseAutomatic;
  const bar = jobsBar({
    ready: ready.length,
    running: running.length,
    paused,
    settingsLoaded: !!engine.settings,
  });
  const press: Record<BarButton["id"], () => void> = {
    automatic: () => void engine.update({ pauseAutomatic: !paused }),
    runAll: () => void runAll(),
    stopAll: () => void all(running.map((j) => api.stop(j.name))),
    add: () => nav.navigate("JobEdit", {}),
  };

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
            ListEmptyComponent={<Empty title={t("phone.jobsNone")} />}
            ListFooterComponent={error ? <Caption>{error}</Caption> : null}
            renderItem={renderJob}
          />
        </MoveScope>
      </View>
      <JobsBar buttons={bar} onPress={(id) => press[id]()} />
    </Floating>
  );
}

/**
 * The list's three actions side by side at the foot of the screen, equally
 * wide. Each word is measured at the buttons' type, so a long translation or
 * a large font turns the row into glyphs instead of cutting a word short.
 */
function JobsBar({ buttons, onPress }: { buttons: BarButton[]; onPress: (id: BarButton["id"]) => void }) {
  const { t } = useT();
  const { p, labels } = useTheme();
  const frame = useFrame();
  const column = useSideRoom();
  // Beside the side bar the row stands at the end of the page, as the web's
  // page actions do, in the same place as every other floating page action.
  const inset = floatingInset(frame);
  const side = frame.wide ? inset.end : column;
  const wide = frame.wide;
  const [room, setRoom] = useState(0);
  const [words, setWords] = useState<Record<string, number>>({});
  const fit = barFit(
    labels,
    buttons.map((b) => words[t(b.label)]),
    { room, gap: space.sm, pad: space.sm, glyph: GLYPH },
  );
  return (
    <View style={[styles.bar, { paddingHorizontal: side, paddingBottom: inset.bottom, backgroundColor: p.background }]}>
      <View
        style={styles.barMeasure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {buttons.map((b) => {
          const word = t(b.label);
          return (
            <Text
              key={b.id}
              numberOfLines={1}
              style={styles.barWord}
              onLayout={(e) => {
                const width = Math.ceil(e.nativeEvent.layout.width);
                setWords((known) => (known[word] === width ? known : { ...known, [word]: width }));
              }}
            >
              {word}
            </Text>
          );
        })}
      </View>
      <View style={[styles.barRow, wide ? styles.barRowWide : null]} onLayout={(e) => setRoom(e.nativeEvent.layout.width)}>
        {buttons.map((b) => (
          <View key={b.id} style={styles.barSlot}>
            <Button
              label={t(b.label)}
              spoken={t(b.spoken)}
              glyph={fit === "words" ? undefined : b.glyph}
              glyphOnly={fit === "glyphs"}
              tone={b.tone}
              disabled={b.disabled}
              wide={false}
              snug
              onPress={() => onPress(b.id)}
            />
          </View>
        ))}
      </View>
    </View>
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
  menu: CardEntry[];
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
  const { wide } = useFrame();

  const joins = (
    <>
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
      {job.minAgeDays ? <Caption>{t("jobs.fact.minAge", { days: job.minAgeDays })}</Caption> : null}

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
    </>
  );

  const state = (
    <>
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
      {jobStatus(job, { held, conflict, notes: noted }) === "failed" ? <FailedBecause run={job.recent[0]!} lines={2} /> : null}
      {jobStatus(job, { held, conflict, notes: noted }) === "empty" ? <TakesNothing lines={3} /> : null}

      {/* Two buttons, since a held job can still be started by hand. A
          running job's button cancels the run rather than pausing, which is
          what the hold button does. The control that goes ahead sits on the
          right. Both are quiet, since Add at the foot is the screen's one
          accent. */}
      <View style={[styles.actions, wide ? styles.actionsAcross : null]}>
        <Button
          wide={!wide}
          label={job.disabled ? t("jobs.resume") : t("jobs.pause")}
          labelKey={job.disabled ? "jobs.resume" : "jobs.pause"}
          // As on the web: Pause stops a run too, and Resume only needs
          // explaining while a paused job runs anyway.
          hint={job.disabled ? (job.running ? t("jobs.resumeRunningHint") : undefined) : t("jobs.pauseHint")}
          busy={holding}
          onPress={onHold}
        />
        <Button
          wide={!wide}
          label={job.running ? t("jobs.cancelRun") : t("jobs.runNow")}
          labelKey={job.running ? "jobs.cancelRun" : "jobs.runNow"}
          busy={busy}
          onPress={onAct}
        />
      </View>
    </>
  );

  return (
    <Card onPress={onOpen} hue={hue} {...moving}>
      <CardHead mark={mark} title={job.name}>
        <View style={styles.menuSlot}>
          <CardMenu items={menu} />
        </View>
      </CardHead>
      {/* Beside the side bar, as the web's card: what the job joins on the
          left, its status over its buttons on the right. */}
      {wide ? (
        <View style={styles.across}>
          <View style={styles.joins}>{joins}</View>
          <View style={styles.state}>{state}</View>
        </View>
      ) : (
        <>
          {joins}
          {state}
        </>
      )}
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
 * More beside Run now as glyphs, so the name keeps the room. The hold moves
 * into More. A tap opens the job, as on the card.
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
  menu: CardEntry[];
  moving: Moving;
}) {
  const { t, lang } = useT();
  const { p } = useTheme();
  const { wide } = useFrame();
  const hue = useHue(index);
  const last = job.recent[0];
  const status = jobStatus(job, { held, conflict, notes: noted });
  // The status of a job that ran fine is already the time of that run.
  const quiet = status === "last";
  const name = (
    <>
      <Text style={[styles.rowName, { color: p.text }]} numberOfLines={1}>
        {job.name}
      </Text>
      {status === "failed" ? <FailedBecause run={last!} lines={1} /> : null}
      {status === "empty" ? <TakesNothing lines={1} /> : null}
    </>
  );
  const statusLine = (
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
  );
  const lastRun = last && !quiet ? <Caption>{t("jobs.lastRun", { when: clock(last.Finished, lang) })}</Caption> : null;
  return (
    <Card onPress={onOpen} hue={hue} style={styles.row} {...moving}>
      <View style={[styles.mark, { backgroundColor: hue }]} />
      {/* Beside the side bar the status and the last run take columns of
          their own, as on the web's compact row. */}
      {wide ? (
        <View style={styles.rowAcross}>
          <View style={styles.rowText}>{name}</View>
          <View style={styles.rowStatusCell}>{statusLine}</View>
          <View style={styles.rowLastCell}>{lastRun}</View>
        </View>
      ) : (
        <View style={styles.rowText}>
          {name}
          <View style={styles.rowStatus}>
            {statusLine}
            {lastRun}
          </View>
        </View>
      )}
      <CardMenu items={menu} glyphOnly />
      <Button
        label={job.running ? t("jobs.cancelRun") : t("jobs.runNow")}
        labelKey={job.running ? "jobs.cancelRun" : "jobs.runNow"}
        glyphOnly
        wide={false}
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
          {job.queued ? <Badge label={t("status.queued")} /> : <Badge label={t("status.running")} tone="accent" />}
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
    case "empty":
      return <Badge label={t("status.empty")} tone="warn" />;
    case "away":
      return <Badge label={t("status.away")} />;
    case "failed":
      return <Badge label={t("status.failed")} tone="fail" />;
    case "paused":
      return <Badge label={t("status.paused")} />;
    case "stopped":
      return <Badge label={t("status.stopped")} />;
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

/** Why the job's last run failed, cut short, since the job's own screen has it whole. */
function FailedBecause({ run, lines }: { run: Run; lines: number }) {
  const { t, lang } = useT();
  const { p } = useTheme();
  return (
    <Text style={[styles.failure, { color: p.failInk }]} numberOfLines={lines}>
      {failureLine(run.Err, run.Failure, t, lang)}
    </Text>
  );
}

/** Why the job takes no files, under its badge, as a failed job says why it failed. */
function TakesNothing({ lines }: { lines: number }) {
  const { t } = useT();
  const { p } = useTheme();
  return (
    <Text style={[styles.failure, { color: p.warnInk }]} numberOfLines={lines}>
      {t("status.emptyHint")}
    </Text>
  );
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
  rowAcross: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.lg },
  rowStatusCell: { width: 200, alignItems: "flex-start" },
  rowLastCell: { width: 180, alignItems: "flex-end" },
  across: { flexDirection: "row", alignItems: "center", gap: space.xl },
  joins: { flex: 1, minWidth: 0, gap: space.sm },
  state: { flexShrink: 0, maxWidth: "45%", alignItems: "flex-end", gap: space.sm },
  actionsAcross: { justifyContent: "flex-end" },
  way: { flexDirection: "row", alignItems: "center", gap: space.sm },
  finding: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  findingText: { flex: 1, fontSize: text.subline, lineHeight: 18 },
  failure: { fontSize: text.subline, lineHeight: 18 },
  // Room at the end so the bar at the foot does not cover the last card.
  list: { padding: space.lg, gap: space.md, paddingBottom: FAB_ROOM },
  status: { gap: space.sm, alignSelf: "stretch", alignItems: "flex-start" },
  // A touch target of its own, though the badge inside stays small.
  statusPress: { alignSelf: "flex-start", minHeight: TOUCH, justifyContent: "center" },
  quiet: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: space.sm },
  barRow: { flexDirection: "row", gap: space.sm },
  barRowWide: { alignSelf: "flex-end", width: 480 },
  barSlot: { flex: 1, minWidth: 0 },
  // Invisible copies of the words at the buttons' type, for their one-line widths.
  barMeasure: { position: "absolute", left: 0, top: 0, opacity: 0, alignItems: "flex-start" },
  barWord: { fontSize: text.body, fontWeight: "600" },
});
