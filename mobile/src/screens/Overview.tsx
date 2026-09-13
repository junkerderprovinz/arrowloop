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
import { Badge, Body, Caption, Card, CardHead, Empty, Fab, Floating, Meter, Mono, Page, Pair, Title, useHue, useTheme } from "../ui";
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
/**
 * How often the stream's news reaches the screen, in milliseconds.
 *
 * Eight times a second. See the comment at the refs below for why this is a
 * rate rather than "whenever an event arrives".
 */
const DRAW_MS = 120;

/**
 * The newest run across every job, and what it moved.
 *
 * ONE HOOK FOR TWO CARDS, because it is one question. The status card and the
 * changes card both describe the same run, and two copies of this would be two
 * requests and - the part that actually bites - two moments in time: the cards
 * would disagree for as long as one of them was still loading.
 *
 * ONLY when a run ENDS, which is the only moment this can change. It took the
 * generic "something happened" hook first, and that one passes on every
 * progress line - so during a run over three thousand files these cards asked
 * the engine for the history and a summary hundreds of times a second.
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
      // Cards that cannot be read say nothing rather than an error: the page
      // above them is already reporting whether the engine answers.
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

  /*
  WHAT THE STREAM SAID lives in refs; what the SCREEN draws lives in state, and
  the two are joined at a fixed rate rather than once per event.

  Measured reason: the engine publishes a line per finished step, and a run over
  four thousand small files sends more than a hundred a second. Setting state on
  each one re-rendered this screen a hundred times a second, which made the
  phone warm and - the part that matters here - left nothing for an animation to
  animate: a bar retargeted every eight milliseconds never travels anywhere, it
  simply is wherever it last was.

  Eight times a second is above what an eye resolves as steps and far below what
  the stream delivers, so the bar glides and the phone stays cool.
  */
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

  // The stream keeps the PROGRESS; the job list keeps the roster. A run that
  // started before this screen opened has no progress line yet, and the list is
  // what says it is running at all - so the two are held apart rather than one
  // being derived from the other.
  useEngineStream(true, (event: RunEvent) => {
    if (event.phase === "moving") {
      // An ABSENT list means nothing is in the air: the engine drops an empty
      // one from the JSON rather than sending null on every other frame. See
      // internal/daemon/runner.go.
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
    // Started and finished both change the roster, so both go and ask. The
    // progress is dropped on the way out: a bar left at 98% under a job that
    // ended an hour ago is a lie that nothing later corrects.
    if (event.phase === "finished") {
      delete heard.current.live[event.job];
      delete heard.current.moving[event.job];
      delete heard.current.rate[event.job];
    }
    // A run starting or ending is the one moment worth drawing AT ONCE: it is
    // rare, and it is the frame the layout animation below rides on.
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    animateNext(motion);
    draw();
    void load();
  });

  const running = useMemo(() => (jobs ?? []).filter((j) => j.running), [jobs]);

  /*
  A CARD ARRIVING AND GOING is a layout change, so it takes the layout engine
  rather than a driven value: one call before the commit animates the whole
  subtree, including the file rows inside the card.

  Keyed on the NAMES of what is running, so it fires when the set changes and
  not on every re-render - this screen redraws eight times a second while a run
  is going, and configuring a layout animation that often would animate the
  progress caption's own text reflow.
  */
  const roster = running.map((j) => j.name).join("\n");
  useEffect(() => {
    animateNext(motion);
  }, [roster, motion]);

  if (!jobs) return <Empty title={t("history.working")} detail={error || undefined} />;

  return (
    <Floating>
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
      <SyncStatus jobs={jobs} run={last.run} tally={last.tally} />

      {/* WHAT THE LAST RUN MOVED, its own card. Autosync keeps "when" and
          "what" apart, and so does this: somebody checking whether their photos
          went up reads exactly one of the four lines below. */}
      <Title>{t("overview.changes")}</Title>
      <LastChanges tally={last.run === "none" ? null : last.tally} />

      <Title>{t("overview.accounts")}</Title>
      <Accounts />

      {error ? <Caption>{error}</Caption> : null}
    </Page>

    {/* THE ONE BUTTON THAT STARTS EVERYTHING, and it is the SAME KIND of button
        as the one that creates a job. jdp: "jetzt abgleichen soll ein button
        sein wie der wo man ein auftrag anlegt und er soll Syncronisieren heißen
        mit glyph (pfeile die einen kreis bilden)."

        Floating rather than standing in the page, for the reason that shape
        exists at all: it is the page's ONE act, and a control that scrolls away
        with the content is one somebody has to go back for. The jobs list
        already settled this ("die button ... soll ein schwebender button rechts
        unten sein"), and a second page inventing a second answer would be two
        ideas about the same thing.

        It starts every job that COULD run - switched on, with both sides, not
        already going - because this screen has no single job selected and
        "synchronise" on a page about the whole phone means all of it. A job
        somebody switched off stays off: that switch is an instruction.

        And it becomes the ABORT while anything runs, the same shape the job
        cards took when jdp asked for it there. */}
    <SyncNow jobs={jobs} running={running} onDone={load} />
    </Floating>
  );
}

/**
 * Start everything, or stop everything, depending on which is useful.
 *
 * ONE REQUEST PER JOB because that is what the engine offers, and they are
 * fired together rather than in turn: the engine already decides how many runs
 * it will have at once (`parallelJobs`), and a screen that queued them itself
 * would be a second, worse scheduler. A job that refuses - it started a
 * half-second ago from its own schedule - is left alone rather than reported:
 * "already running" is the outcome the button wanted anyway.
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

  // What the button would actually reach. A draft with no sides cannot run, and
  // a switched-off job must not be switched on by a button that says "now".
  const ready = jobs.filter((j) => !j.disabled && !j.running && j.left && j.right);
  const live = running.length > 0;

  // Nothing to start and nothing to stop: no button at all rather than a dead
  // one. This is the state of a fresh install, and a greyed-out control is a
  // thing somebody tries to press.
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
      // The KEY picks the mark, so the two states wear two marks without this
      // call site naming either: the circle of arrows while there is something
      // to start, the cancel mark while there is something to stop.
      labelKey={live ? "jobs.cancelRun" : "overview.syncNow"}
      onPress={() => void act()}
    />
  );
}

/**
 * A moment, written the way the reader's own phone writes moments.
 *
 * ABSOLUTE and not relative, which is a correction: the status card first used
 * the same "22 Minuten her" the job cards use, and that helper only counts
 * BACKWARDS. Applied to the next due run it printed "0 Sekunden", because a
 * time in the future is zero seconds ago. Seen on the device.
 *
 * Absolute is also simply the better reading here. Autosync's card says "Heute
 * 04:27", and a status card is scanned for "when", where a clock time answers
 * in one glance and an elapsed count has to be subtracted from now.
 *
 * The PHONE'S OWN format, via the app's language, so the order of day and month
 * and the twelve-or-twenty-four hour question are answered where they are
 * already answered. A date that cannot be parsed comes back as a dash rather
 * than as "Invalid Date".
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
    // An unknown language tag is not a reason to show nothing.
    return at.toLocaleString();
  }
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
function SyncStatus({ jobs, run, tally }: { jobs: Job[]; run: Run | null | "none"; tally: Tally | null }) {
  const { t, lang } = useT();
  /*
  THE NEXT DUE TIME ACROSS EVERY JOB, and whether anything is going right now.

  The engine reports a due time per job and this card asks one question, so the
  EARLIEST of them is the answer: "when will something next happen here". Jobs
  the clock will never start report nothing and drop out on their own, which is
  why this needs no second rule for switched-off or hand-started jobs.
  */
  const due = jobs
    .map((j) => j.nextRun)
    .filter((s): s is string => Boolean(s))
    .sort()[0];
  const running = jobs.some((j) => j.running);

  if (run === null) return <Card><Caption>{t("history.working")}</Caption></Card>;
  if (run === "none") {
    return (
      <Card>
        <Body>{t("history.empty")}</Body>
      </Card>
    );
  }

  /*
  FIVE FACTS ON FIVE LINES, which is the shape jdp asked for: "kannst du bitte
  die Übersichtsseite von Autosync anschauen. ich hätte sie auch gerne so."
  Autosync's status card is label and value, one per line - last sync, finished
  at, duration, state, next sync - and the prose sentence that used to stand
  here answered the same questions in a form nobody scans.

  NEXT SYNC IS THE ONE THAT WAS MISSING ENTIRELY, and it is the line somebody
  opens this page for: the other four say what already happened. It is the
  earliest of the times the engine reports per job, and "by hand" where no
  clock is going to start anything.
  */
  const finished = run.Finished ? new Date(run.Finished) : null;
  const started = new Date(run.Started);
  const secs = finished ? Math.max(0, Math.round((finished.getTime() - started.getTime()) / 1000)) : null;

  return (
    <Card>
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
      {failed(run) ? (
        // The engine's own sentence, under the five facts. A card that said
        // "failed" and nothing else would send somebody to the history tab to
        // read the one line that matters.
        <Body>{run.Err}</Body>
      ) : null}
    </Card>
  );
}

/**
 * What the last run actually moved, four numbers on four lines.
 *
 * Autosync's second card, and the reason it is a card of its own rather than a
 * sentence under the status: the two answer different questions. The status
 * says WHEN, this says WHAT, and somebody checking whether their photos went up
 * is reading exactly one of the four lines.
 *
 * DELETIONS ARE SPLIT BY SIDE, which the old single number could not do. "12
 * gelöscht" on a two-way job leaves the reader guessing which end lost the
 * files, and that is the one thing a deletion count is checked for.
 *
 * Every line is shown, including the zeroes. That is the opposite of the rule
 * the history cards follow, and deliberately: a card of label-value pairs is a
 * FORM somebody reads down, and a form whose rows appear and disappear is one
 * whose rows move under the eye. "Download 0 Dateien" is also an answer.
 */
function LastChanges({ tally }: { tally: Tally | null }) {
  const { t } = useT();
  if (!tally) return <Card><Caption>{t("history.working")}</Caption></Card>;
  return (
    <Card>
      <Pair label={t("overview.uploadedLabel")} value={t("overview.files", { count: tally.up })} />
      <Pair label={t("overview.downloadedLabel")} value={t("overview.files", { count: tally.down })} />
      <Pair label={t("overview.deletedHere")} value={t("overview.files", { count: tally.trashedLeft })} />
      <Pair label={t("overview.deletedThere")} value={t("overview.files", { count: tally.trashedRight })} />
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
  if (parts.length === 0) {
    // Every fiftieth run that had nothing to do says so differently. See
    // src/eggs.tsx: it is arithmetic on the run's own number rather than a
    // random draw, so the same run always says the same thing and can be shown
    // to somebody. The count it replaces is repeated nowhere else on this card,
    // which is why the sentence is allowed to stand in for it.
    if (isPerfectlyIdle(run.ID, run.Unchanged)) return t("history.perfectlyIdle");
    return t("preview.identical", { count: run.Unchanged });
  }
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
      (storage) => live && setRemotes(storage.remotes.filter(isAccount)),
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
  /*
  WHO AND WHERE, under the name. Autosync's account block carries the login and
  the address beside the size, and jdp asked for that page - with reason: a list
  of target NAMES answers "which ones are set up" and not "which account is this
  and where does it point", which is what somebody checks when a card says the
  wrong number.

  Read from the target's own settings rather than from a product table, so a
  backend this app has never heard of still shows whatever it does carry. A
  secret is never shown: the engine masks them before they leave it, and a row
  of asterisks under a card would be noise pretending to be information.
  */
  const said = (key: string) => remote.settings.find((s) => s.key === key && !s.secret)?.value;
  // ONLY a user NAME. `access_key_id` is not marked secret and is a credential
  // all the same - half of one, and the half that names the account. A card
  // that printed it would put it in every screenshot of this page.
  const who = said("user");
  const where = said("url") ?? said("endpoint") ?? said("remote");
  return (
    <Card hue={hue}>
      <CardHead mark={remote.mark} title={remote.name}>
        {unreachable(room) ? (
          <View style={styles.badgeSlot}>
            <Badge label={t("targets.checkFailed")} tone="fail" />
          </View>
        ) : null}
      </CardHead>
      {who ? <Caption>{who}</Caption> : null}
      {where ? <Caption>{where}</Caption> : null}
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
