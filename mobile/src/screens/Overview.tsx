import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  api,
  failed,
  type Job,
  type Moving as MovingFile,
  type Remote,
  type Run,
  type RunEvent,
  type Tally,
} from "../api";
import { isPerfectlyIdle } from "../eggs";
import { Glyph } from "../glyphs";
import { useT, type T } from "../i18n";
import { animateNext, useMotion } from "../motion";
import { bytes, isAccount, Room, unreachable, useRoom, type Room as Space } from "../space";
import { space } from "../theme";
import { useEngineStream } from "../useEngine";
import { Badge, Body, Caption, CardHead, Empty, Fab, Floating, Meter, Mono, Page, Pair, Section, Title, useHue, useTheme } from "../ui";
import { when } from "./Jobs";

// The overview: what is running now, drawn from the event stream rather than
// polling, then the last run and how full each target is.

/** How often stream updates reach the screen, in milliseconds. */
const DRAW_MS = 120;

/**
 * Returns the newest run across all jobs and its tally, shared by the status
 * and changes cards so they describe the same moment. It reloads only when a
 * run finishes, not on every progress event.
 */
function useLastRun(): { run: Run | null | "none"; tally: Tally | null } {
  const [run, setRun] = useState<Run | null | "none">(null);
  const [tally, setTally] = useState<Tally | null>(null);

  const load = useCallback(async () => {
    try {
      const recent = await api.history(1);
      const newest = recent[0];
      if (!newest) {
        setRun("none");
        return;
      }
      setRun(newest);
      setTally(await api.runSummary(newest.ID));
    } catch {
      // The app already reports an engine that does not answer.
      setRun("none");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEngineStream(true, (event) => {
    if (event.phase === "finished") void load();
  });

  return { run, tally };
}

export function Overview() {
  const { t } = useT();
  const last = useLastRun();
  const { intensity: motion } = useMotion();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [live, setLive] = useState<Record<string, Progress>>({});
  // Files in transfer per job, which arrive on their own frames.
  const [moving, setMoving] = useState<Record<string, MovingFile[]>>({});
  // Files per second, sent instead of the rows when files are too many to name.
  const [rate, setRate] = useState<Record<string, number>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setJobs(await api.jobs());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Stream events collect in refs and reach state at most every DRAW_MS: a run
  // over many small files sends more than a hundred events a second, and a
  // render per event would leave the bars no time to animate.
  const heard = useRef<{
    live: Record<string, Progress>;
    moving: Record<string, MovingFile[]>;
    rate: Record<string, number>;
  }>({ live: {}, moving: {}, rate: {} });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draw = useCallback(() => {
    setLive({ ...heard.current.live });
    setMoving({ ...heard.current.moving });
    setRate({ ...heard.current.rate });
  }, []);

  const drawSoon = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      draw();
    }, DRAW_MS);
  }, [draw]);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  // The stream gives the progress; the job list says which jobs run, since a
  // run started before this screen opened has sent no progress yet.
  useEngineStream(true, (event: RunEvent) => {
    if (event.phase === "moving") {
      // The engine omits an empty list (internal/daemon/runner.go).
      heard.current.moving[event.job] = event.moving ?? [];
      heard.current.rate[event.job] = event.rate ?? 0;
      drawSoon();
      return;
    }
    if (event.phase === "progress") {
      heard.current.live[event.job] = { done: event.done ?? 0, total: event.total ?? 0 };
      drawSoon();
      return;
    }
    // Started or finished: the job list changes, and a finished job's
    // progress is dropped.
    if (event.phase === "finished") {
      delete heard.current.live[event.job];
      delete heard.current.moving[event.job];
      delete heard.current.rate[event.job];
    }
    // Drawn at once, since the layout animation rides on this frame.
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    animateNext(motion);
    draw();
    void load();
  });

  const running = useMemo(() => (jobs ?? []).filter((j) => j.running), [jobs]);

  // Animates cards arriving and leaving. Keyed on the running set rather than
  // every render, which during a run happens eight times a second.
  const roster = running.map((j) => j.name).join("\n");
  useEffect(() => {
    animateNext(motion);
  }, [roster, motion]);

  if (!jobs) return <Empty title={t("history.working")} detail={error || undefined} />;

  return (
    <Floating>
    <Page>
      <Section title={t("overview.running")} hue={0}>
        {running.length === 0 ? (
          <>
            <Body>{t("overview.idle")}</Body>
            <Caption>{t("overview.idleHint")}</Caption>
          </>
        ) : (
          running.map((job, index) => (
            <Running
              key={job.name}
              job={job}
              at={live[job.name]}
              moving={moving[job.name] ?? []}
              rate={rate[job.name] ?? 0}
              index={index}
            />
          ))
        )}
      </Section>

      <Section title={t("overview.status")} hue={1}>
        <SyncStatus jobs={jobs} run={last.run} tally={last.tally} />
      </Section>

      <Section title={t("overview.changes")} hue={2}>
        <LastChanges tally={last.run === "none" ? null : last.tally} />
      </Section>

      <Section title={t("overview.accounts")} hue={3}>
        <Accounts />
      </Section>

      {error ? <Caption>{error}</Caption> : null}
    </Page>

    <SyncNow jobs={jobs} running={running} onDone={load} />
    </Floating>
  );
}

/**
 * The floating button that starts every job able to run, or stops every
 * running one. Requests go out together, since the engine limits concurrent
 * runs itself (`parallelJobs`). A job that refuses because it just started on
 * its own schedule is not reported.
 */
function SyncNow({
  jobs,
  running,
  onDone,
}: {
  jobs: Job[];
  running: Job[];
  onDone: () => void;
}) {
  const { t } = useT();

  // Held jobs and drafts without both sides stay out.
  const ready = jobs.filter((j) => !j.disabled && !j.running && j.left && j.right);
  const live = running.length > 0;

  if (!live && ready.length === 0) return null;

  const act = async () => {
    try {
      await Promise.allSettled(
        live ? running.map((j) => api.stop(j.name)) : ready.map((j) => api.run(j.name)),
      );
    } finally {
      onDone();
    }
  };

  return (
    <Fab
      label={live ? t("overview.stopAll") : t("overview.syncNow")}
      // The key picks the glyph for each state.
      labelKey={live ? "jobs.cancelRun" : "overview.syncNow"}
      onPress={() => void act()}
    />
  );
}

/**
 * Formats a moment as an absolute date and time in the app's language. The
 * relative "ago" helper cannot express a time in the future such as the next
 * run.
 */
function clock(iso: string, lang: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "-";
  try {
    return at.toLocaleString(lang, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    // An unknown language tag falls back to the default locale.
    return at.toLocaleString();
  }
}

interface Progress {
  done: number;
  total: number;
}

/**
 * A running job's card. The top bar counts steps of the whole run; each file
 * row below it counts the bytes of one file, as many rows as rclone moves at
 * once.
 */
function Running({
  job,
  at,
  moving,
  rate,
  index,
}: {
  job: Job;
  at?: Progress;
  moving: MovingFile[];
  rate: number;
  index: number;
}) {
  const { t } = useT();
  const hue = useHue(index);
  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <Title>{job.name}</Title>
        <Badge label={t("jobs.state.running")} tone="accent" />
      </View>
      {at ? (
        <>
          <Meter done={at.done} total={at.total} hue={hue} />
          <Caption>{t("progress.of", { done: at.done, total: at.total })}</Caption>
        </>
      ) : (
        // No progress yet while the engine builds its plan.
        <Caption>{t("preview.working")}</Caption>
      )}

      {moving.map((file) => (
        <InFlight key={file.path} file={file} hue={hue} />
      ))}

      {/* Too many small files to name: the engine sends a rate instead of
          rows, so the space does not look like a stall. */}
      {moving.length === 0 && rate > 0 ? (
        <Caption>{t("overview.manySmall", { count: rate })}</Caption>
      ) : null}
    </View>
  );
}

/**
 * One file in transfer. The bar is drawn only when the service reported the
 * file's size, which some clouds do not.
 */
function InFlight({ file, hue }: { file: MovingFile; hue: string }) {
  const { p } = useTheme();
  const known = file.size > 0;
  return (
    <View style={styles.file}>
      <View style={styles.line}>
        {/* The arrow points at the side the file lands on. */}
        {file.side === "left" || file.side === "right" ? (
          <Glyph name={file.side === "left" ? "IconToLeft" : "IconToRight"} color={p.textSub} size={16} />
        ) : null}
        <View style={styles.fileName}>
          <Mono>{file.path}</Mono>
        </View>
      </View>
      {known ? <Meter done={file.bytes} total={file.size} hue={hue} /> : null}
      <Caption>
        {known ? `${bytes(file.bytes)} / ${bytes(file.size)}` : bytes(file.bytes)}
      </Caption>
    </View>
  );
}

/**
 * The status of the newest run across all jobs: when it ran, how long it
 * took, its state, and when the next run is due.
 */
function SyncStatus({ jobs, run, tally }: { jobs: Job[]; run: Run | null | "none"; tally: Tally | null }) {
  const { t, lang } = useT();
  // The earliest due time of any job. Jobs no schedule starts report none.
  const due = jobs
    .map((j) => j.nextRun)
    .filter((s): s is string => Boolean(s))
    .sort()[0];
  const running = jobs.some((j) => j.running);

  if (run === null) return <Caption>{t("history.working")}</Caption>;
  if (run === "none") return <Body>{t("history.empty")}</Body>;

  const finished = run.Finished ? new Date(run.Finished) : null;
  const started = new Date(run.Started);
  const secs = finished ? Math.max(0, Math.round((finished.getTime() - started.getTime()) / 1000)) : null;

  return (
    <>
      <View style={styles.head}>
        <Title>{run.Job}</Title>
        {failed(run) ? <Badge label={t("history.failed")} tone="fail" /> : null}
      </View>
      <Pair label={t("overview.lastSync")} value={clock(run.Started, lang)} />
      {finished ? <Pair label={t("overview.finishedAt")} value={clock(run.Finished as string, lang)} /> : null}
      {secs !== null ? (
        <Pair label={t("overview.duration")} value={t("overview.seconds", { count: secs })} />
      ) : null}
      <Pair
        label={t("overview.state")}
        value={running ? t("jobs.state.running") : failed(run) ? t("history.failed") : t("jobs.state.idle")}
      />
      <Pair label={t("overview.nextSync")} value={due ? clock(due, lang) : t("overview.byHand")} />
      {failed(run) ? <Body>{run.Err}</Body> : null}
    </>
  );
}

/**
 * What the last run moved, with deletions split by side. Zero rows are shown
 * too, so the rows of this label and value card never shift.
 */
function LastChanges({ tally }: { tally: Tally | null }) {
  const { t } = useT();
  if (!tally) return <Caption>{t("history.working")}</Caption>;
  return (
    <>
      <Pair label={t("overview.uploadedLabel")} value={t("overview.files", { count: tally.up })} />
      <Pair label={t("overview.downloadedLabel")} value={t("overview.files", { count: tally.down })} />
      <Pair label={t("overview.deletedHere")} value={t("overview.files", { count: tally.trashedLeft })} />
      <Pair label={t("overview.deletedThere")} value={t("overview.files", { count: tally.trashedRight })} />
    </>
  );
}

/** Summarises a run's non-zero counts in one line. */
function summary(run: Run, tally: Tally | null, t: T): string {
  // Waits for the tally rather than showing the run record's counts and then
  // replacing them.
  if (!tally) return t("history.working");
  const parts: string[] = [];
  if (tally.up > 0) parts.push(t("overview.uploaded", { count: tally.up }));
  if (tally.down > 0) parts.push(t("overview.downloaded", { count: tally.down }));
  if (tally.trashed > 0) parts.push(t("history.trashed", { count: tally.trashed }));
  if (tally.conflicts > 0) parts.push(t("history.conflicts", { count: tally.conflicts }));
  if (parts.length === 0) {
    if (isPerfectlyIdle(run.ID, run.Unchanged)) return t("history.perfectlyIdle");
    return t("preview.identical", { count: run.Unchanged });
  }
  return parts.join(", ");
}

/** Every target and how full it is; an unreachable one says so. */
function Accounts() {
  const { t } = useT();
  const [remotes, setRemotes] = useState<Remote[] | null>(null);

  useEffect(() => {
    let live = true;
    api.storage().then(
      (storage) => live && setRemotes(storage.remotes.filter(isAccount)),
      () => live && setRemotes([]),
    );
    return () => {
      live = false;
    };
  }, []);

  const room = useRoom(remotes);

  if (!remotes) return <Caption>{t("history.working")}</Caption>;
  if (remotes.length === 0) return <Body>{t("targets.storageEmpty")}</Body>;

  return (
    <>
      {remotes.map((remote, index) => (
        <Account key={remote.name} remote={remote} room={room[remote.name]} index={index} />
      ))}
    </>
  );
}

function Account({ remote, room, index }: { remote: Remote; room: Space; index: number }) {
  const { t } = useT();
  const hue = useHue(index);
  // Only the name and the space; the account details are on the targets tab.
  return (
    <View style={styles.block}>
      <CardHead mark={remote.mark} title={remote.name}>
        {unreachable(room) ? (
          <View style={styles.badgeSlot}>
            <Badge label={t("targets.checkFailed")} tone="fail" />
          </View>
        ) : null}
      </CardHead>
      <Room room={room} hue={hue} />
      {room === undefined ? <Caption>{t("history.working")}</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  badgeSlot: { marginStart: "auto" },
  // One job or account among several inside a section.
  block: { gap: space.sm, paddingVertical: space.xs },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  file: { gap: space.xs, marginTop: space.xs },
  // Wraps rather than truncates; the end of a path tells files apart.
  fileName: { flex: 1, minWidth: 0 },
});
