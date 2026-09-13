import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Glyph } from "../glyphs";
import { useT, type T } from "../i18n";
import { bytes, Room, unreachable, useRoom, type Room as Space } from "../space";
import { space } from "../theme";
import { useEngineStream } from "../useEngine";
import { Badge, Body, Caption, Card, CardHead, Empty, Meter, Mono, Page, Title, useHue, useTheme } from "../ui";
import { when } from "./Jobs";

/**
 * What is happening right now, and what it is happening to.
 *
 * jdp: "In Autosync gibt es eine Übersichtsseite wo man schön sieht was gerade
 * läuft (welcher auftrag und welche dateien grade hoch oder runter geladen
 * werden, mit Progressbar) und welche konten verbunden sind inkl. wie viel
 * speicher auf den konten verbraucht ist/frei ist. Das hätte ich auch gerne."
 *
 * Two questions, in that order, and neither of them is answered anywhere else in
 * the app: the job list says a job is running and not what it is doing, and the
 * targets list stopped showing how full anything is when the check button moved
 * into the form.
 *
 * THE LIVE HALF IS DRAWN FROM THE EVENT STREAM, never from polling. The engine
 * publishes a line per file with the count and the total, and the total is known
 * before the first byte moves. Asking again on a timer would show every fourth
 * file at best, and a bar that jumps in fours is worse than no bar - it looks
 * like the transfer is stalling.
 */
export function Overview() {
  const { t } = useT();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [live, setLive] = useState<Record<string, Progress>>({});
  // What each job has in the air, kept apart from the step progress above
  // because they arrive on different frames and mean different things.
  const [moving, setMoving] = useState<Record<string, MovingFile[]>>({});
  // How fast files are going by when they are going by too fast to name. Kept
  // beside the rows rather than inside them, because it is what stands IN THEIR
  // PLACE: the two are never drawn at the same time.
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

  // The stream keeps the PROGRESS; the job list keeps the roster. A run that
  // started before this screen opened has no progress line yet, and the list is
  // what says it is running at all - so the two are held apart rather than one
  // being derived from the other.
  useEngineStream(true, (event: RunEvent) => {
    if (event.phase === "moving") {
      // An ABSENT list means nothing is in the air: the engine drops an empty
      // one from the JSON rather than sending null on every other frame. See
      // internal/daemon/runner.go.
      setMoving((old) => ({ ...old, [event.job]: event.moving ?? [] }));
      setRate((old) => ({ ...old, [event.job]: event.rate ?? 0 }));
      return;
    }
    if (event.phase === "progress") {
      setLive((old) => ({
        ...old,
        [event.job]: {
          done: event.done ?? 0,
          total: event.total ?? 0,
        },
      }));
      return;
    }
    // Started and finished both change the roster, so both go and ask. The
    // progress is dropped on the way out: a bar left at 98% under a job that
    // ended an hour ago is a lie that nothing later corrects.
    if (event.phase === "finished") {
      setLive((old) => {
        const next = { ...old };
        delete next[event.job];
        return next;
      });
      setMoving((old) => {
        const next = { ...old };
        delete next[event.job];
        return next;
      });
      setRate((old) => {
        const next = { ...old };
        delete next[event.job];
        return next;
      });
    }
    void load();
  });

  const running = useMemo(() => (jobs ?? []).filter((j) => j.running), [jobs]);

  if (!jobs) return <Empty title={t("history.working")} detail={error || undefined} />;

  return (
    <Page>
      <Title>{t("overview.running")}</Title>
      {running.length === 0 ? (
        <Card>
          <Body>{t("overview.idle")}</Body>
          <Caption>{t("overview.idleHint")}</Caption>
        </Card>
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

      {/* WHAT HAPPENED LAST, under what is happening now. jdp: "dort gibt es
          eine Synchronisationsstatus card die anzeigt wann zuletzt
          synchronisiert wurde und eine kleine zusammenfassung wie viele datien
          hoch- und runtergeladen und gelöscht wurden etc."

          Below the live half rather than above it, because a screen somebody
          opens to watch should answer "is it working right now" before "what
          did it do earlier". */}
      <Title>{t("overview.status")}</Title>
      <SyncStatus />

      <Title>{t("overview.accounts")}</Title>
      <Accounts />

      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

/** Where one running job has got to, as the stream last said. */
interface Progress {
  done: number;
  total: number;
}

/**
 * One job that is running: how far it has got, and what is in the air.
 *
 * TWO KINDS OF BAR, and they are not the same measurement. The one at the top
 * counts STEPS - files dealt with out of files to deal with - and it is what
 * says how long the run has left. The ones below it count BYTES of one file
 * each, and they are what says the thing has not stalled.
 *
 * The per-file rows are as many as rclone is moving at once, which is the
 * `transfers` setting. jdp: "autosync zeigt in der übersicht immer die
 * einzelnen dateien die grade hoch und runtergeladen werden mit progress bar.
 * je nachdem wie viele up und downloads man gleichzeitig eingestellt hat." The
 * screen never decides how many to draw; it draws what the engine reports, so
 * the setting reaches it without ever being read here.
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
    <Card hue={hue}>
      <View style={styles.head}>
        <Title>{job.name}</Title>
        <Badge label={t("jobs.state.running")} tone="accent" />
      </View>
      {at ? (
        <>
          {/* The whole run, counted in steps. The number under it is the same
              fact in figures, which is what a bar cannot give: "941 von 12000"
              says how long this will take and a bar at eight percent does not. */}
          <Meter done={at.done} total={at.total} hue={hue} />
          <Caption>{t("progress.of", { done: at.done, total: at.total })}</Caption>
        </>
      ) : (
        // Running, with nothing said yet. That is a real state and a common
        // one: the engine builds the plan before it moves a byte, and on a big
        // pair of folders that is where most of a short run is spent.
        <Caption>{t("preview.working")}</Caption>
      )}

      {/* And the files themselves. Nothing at all when nothing is in the air,
          which is most of a run: listing, comparing and writing state move no
          bytes, and a row that lingered after its file had landed would be the
          one thing on this screen that was not true. */}
      {moving.map((file) => (
        <InFlight key={file.path} file={file} hue={hue} />
      ))}

      {/* WHEN THERE ARE NO ROWS BECAUSE THERE ARE TOO MANY FILES, the rate says
          so. A run pushing two hundred small files a second draws nothing here
          on purpose - asking rclone which four are in the air right now costs
          the run more than the answer is worth - and an empty space under a
          running job reads as a stall. jdp picked this over leaving it blank.

          Only when there is nothing to draw: a rate arrives only on a frame
          without rows, so the two can never both be on screen. */}
      {moving.length === 0 && rate > 0 ? (
        <Caption>{t("overview.manySmall", { count: rate })}</Caption>
      ) : null}
    </Card>
  );
}

/**
 * One file part-way across: which way, what it is called, how far.
 *
 * The path gets the monospace and the room to wrap, because it is the line
 * somebody is actually watching. The bar underneath is BYTES of this one file,
 * and it is drawn only where the service said how big the file is - some clouds
 * do not, and a bar drawn against an unknown size would sit full and still.
 */
function InFlight({ file, hue }: { file: MovingFile; hue: string }) {
  const { p } = useTheme();
  const known = file.size > 0;
  return (
    <View style={styles.file}>
      <View style={styles.line}>
        {/* Which way it is going, drawn rather than spelled - the side it LANDS
            on, which is the same fact as its direction. */}
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
 * When this phone last synced anything, and what came of it.
 *
 * jdp: "eine Synchronisationsstatus card die anzeigt wann zuletzt
 * synchronisiert wurde und eine kleine zusammenfassung wie viele datien hoch-
 * und runtergeladen und gelöscht wurden etc."
 *
 * THE NEWEST RUN ACROSS EVERY JOB, not a row per job. "When did this last
 * sync" is one question with one answer, and a list of jobs is what the tab
 * next door is for.
 *
 * The up-and-down split is not in the run record - it counts copies, not
 * directions - so it is counted from the run's own lines, where every one
 * carries the side it landed on. One extra request, for the run that is being
 * named anyway.
 */
function SyncStatus() {
  const { t } = useT();
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
      // A status card that cannot be read says nothing rather than an error:
      // the page above it is already reporting whether the engine answers.
      setRun("none");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // ONLY when a run ENDS, which is the only moment this can change.
  //
  // It took the generic "something happened" hook first, and that hook passes
  // on every progress line - so during a run over three thousand files this
  // card asked the engine for the history and a summary hundreds of times a
  // second. Measured on the device, where it showed up as a card that never
  // settled on a number.
  useEngineStream(true, (event) => {
    if (event.phase === "finished") void load();
  });

  if (run === null) return <Card><Caption>{t("history.working")}</Caption></Card>;
  if (run === "none") {
    return (
      <Card>
        <Body>{t("history.empty")}</Body>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.head}>
        <Title>{run.Job}</Title>
        {failed(run) ? <Badge label={t("history.failed")} tone="fail" /> : null}
      </View>
      <Caption>{`${t("overview.lastSync")}: ${when(run.Finished || run.Started, t)} ${t("jobs.ago")}`}</Caption>
      {failed(run) ? (
        // The engine's own sentence. A card that said "failed" and nothing else
        // would send somebody to the history tab to read the one line that
        // matters.
        <Body>{run.Err}</Body>
      ) : (
        <Body>{summary(run, tally, t)}</Body>
      )}
    </Card>
  );
}

/**
 * The small summary: what went up, what came down, what went to the bin.
 *
 * Only the counts that are not zero, which is the same rule the history cards
 * follow: a run on an ordinary night has one number worth reading and four
 * zeroes, and printing all five buries the one.
 */
function summary(run: Run, tally: Tally | null, t: T): string {
  // Nothing at all until the count is in. The run record is right there and
  // would make a plausible sentence out of Copied and Trashed - and it would
  // then be replaced a moment later by a different one, which is the worst way
  // to show a number somebody is reading.
  if (!tally) return t("history.working");
  const parts: string[] = [];
  if (tally.up > 0) parts.push(t("overview.uploaded", { count: tally.up }));
  if (tally.down > 0) parts.push(t("overview.downloaded", { count: tally.down }));
  if (tally.trashed > 0) parts.push(t("history.trashed", { count: tally.trashed }));
  if (tally.conflicts > 0) parts.push(t("history.conflicts", { count: tally.conflicts }));
  if (parts.length === 0) return t("preview.identical", { count: run.Unchanged });
  return parts.join(", ");
}

/**
 * Every target, and how full it is.
 *
 * ONE REQUEST PER TARGET, each on its own, because that is what the engine
 * offers: `about` is a live question asked of the service. They are fired
 * together and land as they land - a cloud that takes four seconds to answer
 * must not hold up the three that answered instantly.
 *
 * A target that cannot be reached says so here, which is the other half of what
 * jdp asked for: "welche konten verbunden sind". A list that quietly omitted a
 * broken one would answer the question wrongly and look complete doing it.
 */
function Accounts() {
  const { t } = useT();
  const [remotes, setRemotes] = useState<Remote[] | null>(null);

  useEffect(() => {
    let live = true;
    api.storage().then(
      (storage) => live && setRemotes(storage.remotes),
      () => live && setRemotes([]),
    );
    return () => {
      live = false;
    };
  }, []);

  // The same hook the targets list uses, so the two screens cannot end up
  // disagreeing about how full the same target is.
  const room = useRoom(remotes);

  if (!remotes) return <Card><Caption>{t("history.working")}</Caption></Card>;
  if (remotes.length === 0) {
    return (
      <Card>
        <Body>{t("targets.storageEmpty")}</Body>
      </Card>
    );
  }

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
  return (
    <Card hue={hue}>
      <CardHead mark={remote.mark} title={remote.name}>
        {unreachable(room) ? (
          <View style={styles.badgeSlot}>
            <Badge label={t("targets.checkFailed")} tone="fail" />
          </View>
        ) : null}
      </CardHead>
      <Room room={room} hue={hue} />
      {room === undefined ? <Caption>{t("history.working")}</Caption> : null}
    </Card>
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
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  // One file in the air. Its own small block so the rows do not run into each
  // other when four of them sit under one job.
  file: { gap: space.xs, marginTop: space.xs },
  // The name takes what is left beside the arrow, and wraps rather than being
  // cut: the end of a path is the part that tells two files apart.
  fileName: { flex: 1, minWidth: 0 },
});
