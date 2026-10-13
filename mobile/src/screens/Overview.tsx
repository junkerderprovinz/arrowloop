import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { entryLabel } from "../../../web/src/lib/entryLabel";
import { jobState, needs, type HeadState, type Need } from "../../../web/src/lib/needs";
import { Activity } from "../activity";
import { api, failed, type Job, type Remote, type Run, type Tally } from "../api";
import { clock } from "../clock";
import { engine } from "../engine";
import { Glyph } from "../glyphs";
import { useT, type T } from "../i18n";
import { animateNext, useMotion } from "../motion";
import type { Nav, OverviewStack } from "../nav";
import { RunProgress, useRunProgress, type Progress } from "../progress";
import { SideRow, sideMark } from "../sideRow";
import { sidePair } from "../sides";
import { bytes, isAccount, ReachBadge, Room, useReach, useRoom } from "../space";
import { space, text } from "../theme";
import { useEngineEvents, useEngineStream } from "../useEngine";
import { useWaiting } from "../waiting";
import { WayGlyph, wayLabel, wayOf } from "../way";
import {
  AxisLabel,
  Badge,
  Body,
  Button,
  Caption,
  CardHead,
  Empty,
  Fab,
  Floating,
  Page,
  Pair,
  Press,
  Section,
  Title,
  useHue,
  useTheme,
} from "../ui";

/** How many of the coming runs the overview names. */
const NEXT_SHOWN = 3;

/** The head's states, and one more for a phone with no job, where nothing can be in sync. */
type Head = HeadState | "noJobs";

const HEADLINE = {
  inSync: "phone.headInSync",
  withNotes: "phone.headWithNotes",
  needsYou: "phone.needsYou",
  noJobs: "phone.headNoJobs",
} as const satisfies Record<Head, string>;

/**
 * Which need the head names when several wait: what holds work back first,
 * and a failed job before a note, which the anomalies tile counts anyway.
 */
const FIRST: Record<Need["kind"], number> = {
  conflicts: 0,
  held: 1,
  failed: 2,
  unread: 3,
  warned: 4,
  neverRan: 5,
  notes: 6,
};

/**
 * The start screen: how things stand in one sentence that leads to what
 * needs the person, a few counts, what runs and runs next with the files at
 * work, the last run and how full each target is. Every line that counts
 * something leads to it.
 */
export function Overview() {
  const nav = useNavigation<Nav<OverviewStack>>();
  const { t } = useT();
  const { intensity: motion } = useMotion();
  const waiting = useWaiting();
  const progress = useRunProgress();
  const recent = useRecentRuns();
  const access = useFileAccess();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [remotes, setRemotes] = useState<Remote[] | null>(null);
  const [error, setError] = useState("");
  const { refresh } = waiting;
  const reload = recent.reload;

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
      reload();
      // Asked again on focus, so a target added behind More shows up here.
      api.storage().then((s) => setRemotes(s.remotes), () => setRemotes((was) => was ?? []));
    });
    return stop;
  }, [nav, load, refresh, reload]);

  useEngineEvents(true, load);

  // Animates a run arriving or leaving. Keyed on the running set, since
  // progress redraws the page several times a second.
  const roster = (jobs ?? []).filter((j) => j.running).map((j) => j.name).join("\n");
  useEffect(() => {
    animateNext(motion);
  }, [roster, motion]);

  const accounts = remotes ? remotes.filter(isAccount) : null;

  if (!jobs) return <Empty title={t("history.working")} detail={error || undefined} />;

  // A running job's last result is about to be replaced, so it says nothing yet.
  const settled = jobs.filter((j) => !j.running).map(jobState);
  // The findings are enough to list what waits: listing the conflicts opens
  // every two-way job's sides, and a target that is slow to answer must not
  // hold back a held run. Only "in sync" waits for both.
  const heard = waiting.findings !== null;
  const known = heard && waiting.conflicts !== null;
  const wait = needs(waiting.conflicts ?? 0, waiting.findings ?? [], settled, waiting.unread ?? 0);
  const empty = jobs.length === 0;
  const head: Head = access === false ? "needsYou" : empty ? "noJobs" : wait.head;

  const running = jobs.filter((j) => j.running);
  // Held jobs and drafts without both sides stay out. The requests go out
  // together, since the engine limits how many run at once itself.
  const ready = jobs.filter((j) => !j.disabled && !j.running && j.left && j.right);
  const all = async (work: Promise<unknown>[]) => {
    await Promise.allSettled(work);
    await load();
  };

  const toTab = (tab: string) => nav.getParent()?.navigate(tab);
  // The job's own screen sits in the jobs tab.
  const openJob = (name: string) => nav.getParent()?.navigate("JobsTab", { screen: "JobDetail", params: { name } });
  // Over the job list, so saving the new job lands there.
  const addJob = () => nav.getParent()?.navigate("JobsTab", { screen: "JobEdit", params: {}, initial: false });

  const follow = (need: Need) => {
    switch (need.kind) {
      case "conflicts":
      case "unread":
        return toTab("ConflictsTab");
      case "held":
        return nav.navigate("Anomalies", { job: need.job });
      case "notes":
        return nav.navigate("Anomalies");
      default:
        return openJob(need.job);
    }
  };
  const top = [...wait.items].sort((a, b) => FIRST[a.kind] - FIRST[b.kind])[0];
  // Without file access no job on the phone's folders can run, so it comes
  // before anything the engine reports.
  const lead =
    access === false
      ? {
          detail: `${t("phone.access")} · ${t("phone.permissionDenied")}`,
          go: () => void engine.openStorageSettings().catch(() => {}),
        }
      : top
        ? { detail: needLine(top, t), go: () => follow(top) }
        : null;

  return (
    <Floating>
      <Page fab>
        {access === false || known || empty || (heard && head !== "inSync") ? (
          <StatusHead state={head} detail={lead?.detail} onPress={lead?.go} />
        ) : null}

        <Section title={t("overview.numbers")} hue={0}>
          <View style={styles.tiles}>
            <Tile value={waiting.conflicts} label={t("nav.conflicts")} onPress={() => toTab("ConflictsTab")} />
            {waiting.anomaliesOn !== false ? (
              <Tile
                value={waiting.findings === null ? null : waiting.findings.length}
                label={t("nav.anomalies")}
                onPress={() => nav.navigate("Anomalies")}
              />
            ) : null}
            <Tile
              value={waiting.trash}
              label={t("nav.trash")}
              detail={waiting.trashBytes === null ? undefined : bytes(waiting.trashBytes)}
              onPress={() => nav.navigate("TrashAll")}
            />
          </View>
        </Section>

        <Section title={t("overview.running")} hint={t("overview.idleHint")} hue={1}>
          {empty ? (
            <>
              <Body>{t("phone.noJobs")}</Body>
              <View style={styles.actions}>
                <Button label={t("edit.add")} labelKey="edit.add" tone="accent" wide={false} onPress={addJob} />
              </View>
            </>
          ) : null}
          {!empty && running.length === 0 ? <Body>{t("overview.idle")}</Body> : null}
          {running.map((job) => (
            <RunningJob
              key={job.name}
              job={job}
              index={jobs.indexOf(job)}
              at={progress[job.name]}
              remotes={remotes ?? []}
              onOpen={() => openJob(job.name)}
            />
          ))}
          <Activity progress={progress} jobs={jobs} onOpen={openJob} />
          {empty ? null : <NextRuns jobs={jobs} onOpen={openJob} />}
        </Section>

        <Section title={t("overview.status")} hue={2}>
          <LastRun run={recent.newest} tally={recent.tally} jobs={jobs} />
        </Section>

        {/* Left out without a target elsewhere; adding one is the targets page's work. */}
        {accounts === null || accounts.length > 0 ? (
          <Section title={t("overview.accounts")} hue={3}>
            <Accounts accounts={accounts} />
          </Section>
        ) : null}

        {error ? <Caption>{error}</Caption> : null}
      </Page>

      {running.length > 0 ? (
        <Fab
          label={t("phone.stopAll")}
          // The key picks the glyph: a cancelled run throws its work away.
          labelKey="jobs.cancelRun"
          onPress={() => void all(running.map((j) => api.stop(j.name)))}
        />
      ) : ready.length > 0 ? (
        <Fab label={t("phone.runAll")} labelKey="phone.runAll" onPress={() => void all(ready.map((j) => api.run(j.name)))} />
      ) : null}
    </Floating>
  );
}

/**
 * The newest run across all jobs and what it did. Asked for again only when a
 * run finishes, not on every progress frame.
 */
function useRecentRuns() {
  const [newest, setNewest] = useState<Run | null | "none">(null);
  const [tally, setTally] = useState<Tally | null>(null);

  const reload = useCallback(() => {
    api.history(1).then(
      (runs) => {
        const first = runs[0];
        if (!first) {
          setNewest("none");
          return;
        }
        setNewest(first);
        api.runSummary(first.ID).then(setTally, () => {});
      },
      // The app already reports an engine that does not answer.
      () => setNewest((was) => was ?? "none"),
    );
  }, []);

  useEffect(reload, [reload]);
  useEngineStream(true, (event) => {
    if (event.phase === "finished") reload();
  });

  return { newest, tally, reload };
}

/**
 * Whether Android lets the app read the phone's folders. It is granted on a
 * settings page rather than in a dialog, so it is read again whenever the app
 * comes back to the front. Null until known, and true where Android has no
 * such permission.
 */
function useFileAccess(): boolean | null {
  const [access, setAccess] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () =>
      Promise.all([engine.storageGranted(), engine.storagePossible()]).then(
        ([granted, possible]) => setAccess(granted || !possible),
        () => {},
      );
    void read();
    const sub = AppState.addEventListener("change", (s) => s === "active" && read());
    return () => sub.remove();
  }, []);
  return access;
}

/**
 * How things stand, in one of four fixed sentences. A note never rounds up to
 * "in sync". When something waits, the line under it names the first thing
 * and the head leads there; the rest is counted on the tiles or listed on the
 * jobs page.
 */
function StatusHead({ state, detail, onPress }: { state: Head; detail?: string; onPress?: () => void }) {
  const { t } = useT();
  const { p } = useTheme();
  const ink = state === "inSync" ? p.okInk : state === "noJobs" ? p.textSub : p.warnInk;
  const body = (
    <View style={styles.head}>
      <Glyph name="IconSync" color={ink} size={22} />
      <View style={styles.headWords}>
        <Text style={[styles.headText, { color: p.text }]}>{t(HEADLINE[state])}</Text>
        {detail ? <Caption>{detail}</Caption> : null}
      </View>
    </View>
  );
  return onPress ? (
    <Press onPress={onPress} accessibilityRole="button">
      {body}
    </Press>
  ) : (
    <View accessibilityRole="header">{body}</View>
  );
}

/** One thing that waits: what it is about, then its state in the badges' words. */
function needLine(need: Need, t: T): string {
  switch (need.kind) {
    case "conflicts":
      return `${t("nav.conflicts")} · ${need.count}`;
    case "unread":
      return `${t("needs.unread")} · ${need.count}`;
    case "held":
      return `${need.job} · ${t("anomaly.heldBadge")}`;
    case "notes":
      return `${t("nav.anomalies")} · ${need.count}`;
    case "failed":
      return `${need.job} · ${t("status.failed")}`;
    case "warned":
      return `${need.job} · ${t("status.warned")}`;
    case "neverRan":
      return `${need.job} · ${t("status.never")}`;
  }
}

/**
 * One running job as a sub-card: its two sides with the arrows moving the way
 * the files go and the run's bar. The files themselves stand in one list
 * under all running jobs, so that each file is shown once.
 */
function RunningJob({
  job,
  index,
  at,
  remotes,
  onOpen,
}: {
  job: Job;
  /** The job's place in the job list, so its bar wears the same colour there and here. */
  index: number;
  at?: Progress;
  remotes: Remote[];
  onOpen: () => void;
}) {
  const { t } = useT();
  const { p, corners } = useTheme();
  const hue = useHue(index);
  const [upper, lower] = sidePair(job.left, job.right, t);
  const way = wayOf(job.direction);
  return (
    <Press onPress={onOpen} accessibilityRole="button" style={[styles.well, { backgroundColor: p.surface2, ...corners.card }]}>
      <AxisLabel>{job.name}</AxisLabel>
      <SideRow path={upper} mark={sideMark(job.left, remotes)} />
      <View style={styles.way} accessible accessibilityLabel={wayLabel(way, upper, lower, t("direction.both"))}>
        <WayGlyph way={way} color={p.textSub} flowing />
      </View>
      <SideRow path={lower} mark={sideMark(job.right, remotes)} />
      <RunProgress job={job} at={at} hue={hue} />
      {/* Too many small files to name: the engine sends a rate instead of
          rows, so the run does not look stalled. */}
      {at && at.moving.length === 0 && at.rate > 0 ? (
        <Caption>{t("overview.manySmall", { count: Math.round(at.rate) })}</Caption>
      ) : null}
    </Press>
  );
}

/**
 * The runs the schedule starts next, soonest first, each leading to its job.
 * Without any schedule the one line says that jobs run by hand.
 */
function NextRuns({ jobs, onOpen }: { jobs: Job[]; onOpen: (name: string) => void }) {
  const { t, lang } = useT();
  const { p, corners } = useTheme();
  const due = jobs
    .filter((j): j is Job & { nextRun: string } => Boolean(j.nextRun))
    .sort((a, b) => a.nextRun.localeCompare(b.nextRun))
    .slice(0, NEXT_SHOWN);
  if (due.length === 0) return <Pair label={t("overview.nextSync")} value={t("overview.byHand")} />;
  return (
    <View style={[styles.well, { backgroundColor: p.surface2, ...corners.card }]}>
      <AxisLabel>{t("overview.nextSync")}</AxisLabel>
      {due.map((job) => (
        <Press key={job.name} onPress={() => onOpen(job.name)} accessibilityRole="button" style={styles.nextRow}>
          <Pair label={job.name} value={clock(job.nextRun, lang)} />
        </Press>
      ))}
    </View>
  );
}

/**
 * A run's length as m:ss or h:mm:ss. A number with a unit word would need that
 * word's plural forms in every language, and "1 seconds" is what a single form
 * gives.
 */
function span(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * The newest run across all jobs: which job, when, how long, and what it moved.
 * The change rows stand at zero too, so the card does not shift between runs.
 */
function LastRun({ run, tally, jobs }: { run: Run | null | "none"; tally: Tally | null; jobs: Job[] }) {
  const { t, lang } = useT();
  const { p, corners } = useTheme();
  if (run === null) return <Caption>{t("history.working")}</Caption>;
  if (run === "none") return <Body>{t("history.empty")}</Body>;

  const started = new Date(run.Started).getTime();
  const secs = run.Finished ? Math.max(0, Math.round((new Date(run.Finished).getTime() - started) / 1000)) : null;

  return (
    <>
      <View style={styles.line}>
        <Title>{run.Job}</Title>
        {failed(run) ? <Badge label={t("history.failed")} tone="fail" /> : null}
      </View>
      <Pair label={t("overview.lastSync")} value={clock(run.Started, lang)} />
      {run.Finished ? <Pair label={t("overview.finishedAt")} value={clock(run.Finished, lang)} /> : null}
      {secs !== null ? <Pair label={t("overview.duration")} value={span(secs)} /> : null}
      {failed(run) ? <Body>{run.Err}</Body> : null}
      <View style={[styles.well, { backgroundColor: p.surface2, ...corners.card }]}>
        <AxisLabel>{t("overview.changes")}</AxisLabel>
        {tally ? (
          <Changes tally={tally} job={jobs.find((j) => j.name === run.Job)} />
        ) : (
          <Caption>{t("history.working")}</Caption>
        )}
      </View>
    </>
  );
}

/**
 * What the run copied and deleted on each side, in the history's words, so
 * two folders or two targets go by their names rather than "locally". A job
 * removed since has no sides left to name.
 */
function Changes({ tally, job }: { tally: Tally; job: Job | undefined }) {
  const { t } = useT();
  if (!job) {
    return (
      <>
        <Pair label={t("entry.copied")} value={String(tally.up + tally.down)} />
        <Pair label={t("entry.deleted")} value={String(tally.trashed)} />
      </>
    );
  }
  const label = (Kind: string, Side: string) => entryLabel(t, { Kind, Side }, job, []);
  return (
    <>
      <Pair label={label("copy", "right")} value={String(tally.up)} />
      <Pair label={label("copy", "left")} value={String(tally.down)} />
      <Pair label={label("trash", "left")} value={String(tally.trashedLeft)} />
      <Pair label={label("trash", "right")} value={String(tally.trashedRight)} />
    </>
  );
}

/** A count that leads to what it counts. */
function Tile({
  value,
  label,
  detail,
  onPress,
}: {
  /** Null until the engine has answered. */
  value: number | null;
  label: string;
  detail?: string;
  onPress: () => void;
}) {
  const { p, corners } = useTheme();
  const { lang } = useT();
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.tile, { backgroundColor: p.surface2, ...corners.card }]}
    >
      <Text style={[styles.tileValue, { color: p.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value === null ? "…" : new Intl.NumberFormat(lang).format(value)}
      </Text>
      <Text style={[styles.tileLabel, { color: p.textSub }]} numberOfLines={2}>
        {label}
      </Text>
      {detail ? <Caption>{detail}</Caption> : null}
    </Press>
  );
}

/** Every target elsewhere, whether it answers and how full it is. */
function Accounts({ accounts }: { accounts: Remote[] | null }) {
  const { t } = useT();
  const room = useRoom(accounts);
  const reach = useReach(accounts);

  if (!accounts) return <Caption>{t("history.working")}</Caption>;

  return (
    <>
      {accounts.map((remote, index) => (
        <Account key={remote.name} remote={remote} index={index} room={room[remote.name]} reach={reach[remote.name]} />
      ))}
    </>
  );
}

function Account({
  remote,
  index,
  room,
  reach,
}: {
  remote: Remote;
  index: number;
  room: Room;
  reach: boolean | undefined;
}) {
  const { t } = useT();
  const { p, corners } = useTheme();
  const hue = useHue(index);
  // Only the name and the space; the account details are on the targets page.
  return (
    <View style={[styles.well, { backgroundColor: p.surface2, ...corners.card }]}>
      <CardHead mark={remote.mark} title={remote.name}>
        <View style={styles.badgeSlot}>
          <ReachBadge reach={reach} />
        </View>
      </CardHead>
      <Room room={room} hue={hue} />
      {room === undefined ? <Caption>{t("history.working")}</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Flat, with no card around it, like the head of an object's page.
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs },
  headWords: { flexShrink: 1 },
  headText: { fontSize: text.status, fontWeight: "600" },
  // A sub-card: a flat inset group one step above the card, without a shadow.
  well: { padding: space.md, gap: space.sm },
  way: { flexDirection: "row", alignItems: "center", gap: space.sm },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  nextRow: { minHeight: 32, justifyContent: "center" },
  actions: { flexDirection: "row" },
  tiles: { flexDirection: "row", gap: space.sm },
  tile: { flex: 1, minWidth: 0, padding: space.md, gap: 2 },
  tileValue: { fontSize: text.status, fontWeight: "600", fontVariant: ["tabular-nums", "lining-nums"] },
  tileLabel: { fontSize: text.subline },
  badgeSlot: { marginStart: "auto" },
});
