import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { findingOrder, sentence, type Finding, type Severity, SEVERITIES } from "../../../web/src/lib/anomalies";
import { matchesQuery } from "../../../web/src/lib/fold";
import type { HistoryStack } from "../nav";
import { jobSides } from "../sides";
import { useWaiting } from "../waiting";
import { entryAction, entryLabel, entryNote, groupWord, unreadFolder } from "../../../web/src/lib/entryLabel";
import { failureLine } from "../../../web/src/lib/failure";
import { jobNamesInOrder } from "../../../web/src/lib/jobOrder";
import { runLength } from "../../../web/src/lib/runLength";
import { api, failed, touched, type Entry, type Job, type Run, type Touch } from "../api";
import { isPerfectlyIdle } from "../eggs";
import { fileWay, lineJob } from "../fileWay";
import { Glyph } from "../glyphs";
import { useT, type T } from "../i18n";
import { JobChips } from "../jobChips";
import { ListHead, ListSearch, Narrowed, type SortDir } from "../listHead";
import { space, text } from "../theme";
import { useReadAgain } from "../useEngine";
import {
  AxisLabel,
  Badge,
  Body,
  Caption,
  Choice,
  Empty,
  ListEnd,
  ListPiece,
  ListTop,
  Mono,
  MovingList,
  Pair,
  Press,
  Sheet,
  useTheme,
} from "../ui";
import { capitalized } from "../../../web/src/lib/capitalized";
import { clock } from "../clock";
import { useFrame } from "../frame";
import { FILE_COLUMNS, filesFit, RUN_COLUMNS, runsFit } from "../historyColumns";
import { runFigures } from "../runLine";
import { bytes } from "../usage";

/**
 * The history tab: a list of runs, and a log of every file touched behind a
 * selector. The runs lead because a run that fails before touching anything
 * writes no file lines. The list is one card named after what it shows; its
 * head sorts and filters, the magnifier at its end opens the search, and a
 * row opens its run in a sheet.
 */
export function History() {
  const route = useRoute<RouteProp<HistoryStack, "RunList">>();
  // Runs first: whether a job went through comes before which files it touched.
  const [mode, setMode] = useState<Mode>("runs");
  const asked = route.params?.mode;
  useEffect(() => {
    if (asked) setMode(asked);
  }, [asked]);
  if (mode === "findings") return <FindingLog mode={mode} onMode={setMode} />;
  return mode === "files" ? <FileLog mode={mode} onMode={setMode} /> : <RunLog mode={mode} onMode={setMode} />;
}

type Mode = "files" | "runs" | "findings";

const SEVERITY_LABEL = {
  critical: "anomaly.severity.critical",
  warning: "anomaly.severity.warning",
  info: "anomaly.severity.info",
} as const;

type Sort = { by: string; dir: SortDir };

/** Orders rows by their time or their name, either way round. Ascending time is the oldest first. */
function ordered<R>(rows: R[], sort: Sort, time: (r: R) => string, name: (r: R) => string): R[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) =>
    sort.by === "when" ? sign * time(a).localeCompare(time(b)) : sign * name(a).localeCompare(name(b)),
  );
}

const NEWEST: Sort = { by: "when", dir: "desc" };

/**
 * The entry kinds behind each choice of the files filter. A failure is a
 * `skip` carrying its reason; there is no separate error kind.
 */
const SHOWS = {
  all: [] as string[],
  copied: ["copy", "move"],
  gone: ["trash", "rmdir"],
  trouble: ["conflict", "skip"],
};

type Show = keyof typeof SHOWS;

const SHOW_LABEL = {
  all: "history.everything",
  copied: "history.onlyCopied",
  gone: "history.onlyGone",
  trouble: "history.onlyTrouble",
} as const;

type RunShow = "all" | "changed" | "failed";

const RUN_SHOW_LABEL = {
  all: "history.showAll",
  changed: "history.showChanged",
  failed: "history.showFailed",
} as const;

/** The run a sheet shows: its id and job, and the run itself where the row had it. */
type Opened = { id: number; job: string; run?: Run };

/**
 * Every file the engine has touched, newest first. The engine does the
 * filtering, since the screen holds only the newest page of a long log; the
 * order is applied to that page.
 */
function FileLog({ mode, onMode }: { mode: Mode; onMode: (next: Mode) => void }) {
  const { t, lang, spell } = useT();
  const { p, accent } = useTheme();
  const across = filesFit(useFrame());

  const [rows, setRows] = useState<Touch[] | null>(null);
  const [jobs, setJobs] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Job[]>([]);
  const [drives, setDrives] = useState<{ id: string; label: string }[]>([]);
  const [job, setJob] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>(NEWEST);
  const [filtering, setFiltering] = useState(false);
  const [searching, setSearching] = useState(false);
  // The search is debounced, so the engine sees one query per pause rather
  // than one per keystroke.
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  // Doubles as the list scrolls, rather than paging.
  const [limit, setLimit] = useState(60);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<Opened | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  // Back to one screenful whenever the question changes.
  useEffect(() => setLimit(60), [query, job, show]);

  // The jobs come with every load, so a list the engine could not give at
  // first, or a job made or renamed since, still names the sides.
  const load = useCallback(async () => {
    try {
      const [got, list] = await Promise.all([
        api.log({ job, contains: query, kinds: SHOWS[show], limit }),
        api.jobs().catch(() => null),
      ]);
      setRows(got);
      if (list) {
        setJobs(list.map((j) => j.name));
        setConfigs(list);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [job, query, show, limit]);

  useEffect(() => {
    void load();
  }, [load]);
  useReadAgain(load);

  useEffect(() => {
    // Only for a drive's name in a badge; without it the badge shows the id.
    api.volumes().then(
      (v) => setDrives(v.volumes),
      () => {},
    );
  }, []);
  // Job names from both the configuration and the log: a deleted job still has
  // lines, and a job that never ran has none.
  const names = useMemo(
    () => jobNamesInOrder([...jobs, ...(rows ?? []).map((r) => r.Job)], jobs).filter((name) => name !== ""),
    [jobs, rows],
  );

  const shown = useMemo(
    () => ordered(rows ?? [], sort, (r) => r.When, (r) => r.Path),
    [rows, sort],
  );

  const narrowing = [
    ...(show === "all" ? [] : [t(SHOW_LABEL[show])]),
    ...(job ? [t("list.onlyJob", { job })] : []),
    ...(typed.trim() ? [t("list.searched", { q: typed.trim() })] : []),
  ];
  const header = (
    <>
      <Top mode={mode} onMode={onMode}>
        <Narrowed
          what={narrowing}
          onClear={() => {
            setShow("all");
            setJob("");
            setTyped("");
          }}
        />
      </Top>
      <ListTop title={viewName(t("history.files"), t(SHOW_LABEL[show]), job)} hue={0} />
      <ListPiece>
        <ListSearch
          open={searching}
          value={typed}
          onChange={setTyped}
          onClose={() => setSearching(false)}
          placeholder={t("history.pathHint")}
        />
        <ListHead
          page="history-files"
          sort={sort}
          onSort={(by, dir) => setSort({ by, dir })}
          onSearch={() => setSearching(true)}
          heads={
            across
              ? [
                  {
                    id: "what",
                    label: t("history.filterKind"),
                    width: FILE_COLUMNS.what,
                    filter: { active: show !== "all" || job !== "", open: () => setFiltering(true) },
                  },
                  { id: "when", label: t("list.head.when"), sorts: true, width: FILE_COLUMNS.when },
                  { id: "job", label: t("history.filterJob"), width: FILE_COLUMNS.job },
                  { id: "size", label: t("list.head.size"), width: FILE_COLUMNS.size },
                  { id: "path", label: t("list.head.path"), sorts: true, grow: true },
                ]
              : [
                  {
                    id: "what",
                    label: t("history.filterKind"),
                    filter: { active: show !== "all" || job !== "", open: () => setFiltering(true) },
                  },
                  { id: "when", label: t("list.head.when"), sorts: true },
                  { id: "path", label: t("list.head.path"), sorts: true },
                ]
          }
        />
      </ListPiece>
    </>
  );

  return (
    <>
      <MovingList
        style={{ backgroundColor: p.background }}
        data={shown}
        keyExtractor={(r, i) => `${r.Run}-${r.Path}-${i}`}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={accent} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <ListPiece>
            <Empty
              title={
                rows === null
                  ? t("history.working")
                  : query
                    ? t("jobs.historyNoMatch", { q: query })
                    : t("history.logEmpty")
              }
              detail={error || undefined}
            />
          </ListPiece>
        }
        ItemSeparatorComponent={Separator}
        ListFooterComponent={
          <>
            <ListEnd />
            {error && rows ? <Caption>{error}</Caption> : null}
          </>
        }
        // Only an answer that filled the limit can have more behind it.
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (rows && rows.length >= limit) setLimit((n) => n * 2);
        }}
        renderItem={({ item }) => {
          const labelled = { Kind: item.Kind, Side: item.Side ?? "", Note: item.Note, Path: item.Path, Code: item.Code, Vars: item.Vars };
          const owner = lineJob(item, configs);
          // With the way beside it the badge only says what happened.
          const way = fileWay(item, configs, t);
          const badge = (
            <Badge
              label={way ? entryAction(t, labelled, owner, drives) : entryLabel(t, labelled, owner, drives)}
              tone={tone(item)}
            />
          );
          // Why a path was skipped, or the name a renamed file had.
          const said = entryNote(t, labelled, spell);
          const note = said ? <Caption>{said}</Caption> : null;
          return (
            <ListPiece>
              {across ? (
                <Press
                  onPress={() => setOpened({ id: item.Run, job: item.Job })}
                  accessibilityRole="button"
                  style={[styles.row, styles.across]}
                >
                  <View style={[styles.what, { width: FILE_COLUMNS.what }]}>
                    {badge}
                    {way ? <FileWay way={way} /> : null}
                  </View>
                  <View style={{ width: FILE_COLUMNS.when }}>
                    <Caption>{clock(item.When, lang)}</Caption>
                  </View>
                  <View style={{ width: FILE_COLUMNS.job }}>{item.Job ? <Caption>{item.Job}</Caption> : null}</View>
                  <View style={{ width: FILE_COLUMNS.size }}>{item.Size ? <Caption>{bytes(item.Size)}</Caption> : null}</View>
                  <View style={styles.grow}>
                    <Mono>{item.Path}</Mono>
                    {note}
                  </View>
                </Press>
              ) : (
                <Press onPress={() => setOpened({ id: item.Run, job: item.Job })} accessibilityRole="button" style={styles.row}>
                  <Mono>{item.Path}</Mono>
                  {way ? (
                    <View style={styles.wayLine}>
                      {badge}
                      <FileWay way={way} />
                    </View>
                  ) : null}
                  <View style={styles.meta}>
                    {way ? null : badge}
                    {item.Job ? <Caption>{item.Job}</Caption> : null}
                    <Caption>{clock(item.When, lang)}</Caption>
                    {item.Size ? <Caption>{bytes(item.Size)}</Caption> : null}
                  </View>
                  {note}
                </Press>
              )}
            </ListPiece>
          );
        }}
      />
      <Sheet open={filtering} title={t("history.filter")} onClose={() => setFiltering(false)}>
        <AxisLabel>{t("history.files")}</AxisLabel>
        <Choice<Show>
          hue={1}
          value={show}
          onChange={setShow}
          options={(Object.keys(SHOWS) as Show[]).map((value) => ({ value, label: t(SHOW_LABEL[value]) }))}
        />
        <JobChips names={names} job={job} onJob={setJob} />
      </Sheet>
      <RunSheet opened={opened} jobs={configs} onClose={() => setOpened(null)} />
    </>
  );
}

/**
 * The runs, filtered and ordered here rather than by the engine, since a
 * hundred runs is a small list. A row carries the job and the time, with a
 * green dot for a run that went through and a badge only for one that failed.
 */
function RunLog({ mode, onMode }: { mode: Mode; onMode: (next: Mode) => void }) {
  const { t, lang } = useT();
  const { p, accent } = useTheme();
  const across = runsFit(useFrame());
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [show, setShow] = useState<RunShow>("all");
  const [job, setJob] = useState("");
  const [sort, setSort] = useState<Sort>(NEWEST);
  const [filtering, setFiltering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<Opened | null>(null);
  // The job list's order, which the filter offers the jobs in.
  const [order, setOrder] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Job[]>([]);

  const load = useCallback(async () => {
    try {
      const [got, jobs] = await Promise.all([api.history(100), api.jobs()]);
      setRuns(got);
      setOrder(jobs.map((j) => j.name));
      setConfigs(jobs);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useReadAgain(load);

  const names = useMemo(() => jobNamesInOrder((runs ?? []).map((r) => r.Job), order), [runs, order]);

  const shown = useMemo(() => {
    const needle = typed.trim().toLowerCase();
    const kept = (runs ?? []).filter(
      (r) =>
        (show === "all" || (show === "failed" ? failed(r) : touched(r) > 0)) &&
        (!job || r.Job === job) &&
        (!needle || r.Job.toLowerCase().includes(needle)),
    );
    return ordered(kept, sort, (r) => r.Started, (r) => r.Job);
  }, [runs, show, job, typed, sort]);

  const narrowing = [
    ...(show === "all" ? [] : [t(RUN_SHOW_LABEL[show])]),
    ...(job ? [t("list.onlyJob", { job })] : []),
    ...(typed.trim() ? [t("list.searched", { q: typed.trim() })] : []),
  ];
  const header = (
    <>
      <Top mode={mode} onMode={onMode}>
        <Narrowed
          what={narrowing}
          onClear={() => {
            setShow("all");
            setJob("");
            setTyped("");
          }}
        />
      </Top>
      <ListTop title={viewName(t("history.runs"), t(RUN_SHOW_LABEL[show]), job)} hue={0} />
      <ListPiece>
        <ListSearch
          open={searching}
          value={typed}
          onChange={setTyped}
          onClose={() => setSearching(false)}
          placeholder={t("history.runSearch")}
        />
        <ListHead
          page="history-runs"
          sort={sort}
          onSort={(by, dir) => setSort({ by, dir })}
          onSearch={() => setSearching(true)}
          heads={[
            {
              id: "job",
              label: t("history.filterJob"),
              sorts: true,
              grow: across,
              filter: { active: show !== "all" || job !== "", open: () => setFiltering(true) },
            },
            ...(across
              ? [
                  { id: "state", label: t("list.head.state"), width: RUN_COLUMNS.state },
                  { id: "took", label: t("overview.duration"), width: RUN_COLUMNS.took },
                ]
              : []),
            { id: "when", label: t("list.head.when"), sorts: true, width: across ? RUN_COLUMNS.when : undefined },
          ]}
        />
      </ListPiece>
    </>
  );

  return (
    <>
      <MovingList
        style={{ backgroundColor: p.background }}
        data={shown}
        keyExtractor={(r) => String(r.ID)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={accent} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <ListPiece>
            <Empty
              title={runs === null ? t("history.loading") : runs.length === 0 ? t("history.empty") : t("history.noMatch")}
              detail={error || (runs?.length === 0 ? t("history.nothing") : undefined)}
            />
          </ListPiece>
        }
        ItemSeparatorComponent={Separator}
        ListFooterComponent={
          <>
            <ListEnd />
            {error && runs ? <Caption>{error}</Caption> : null}
          </>
        }
        renderItem={({ item }) => (
          <ListPiece>
            {across ? (
              <RunRowAcross run={item} onPress={() => setOpened({ id: item.ID, job: item.Job, run: item })} />
            ) : (
              <Press
                onPress={() => setOpened({ id: item.ID, job: item.Job, run: item })}
                accessibilityRole="button"
                style={[styles.row, styles.runRow]}
              >
                <Text style={[styles.runName, { color: p.text }]}>
                  {item.Job}
                </Text>
                {failed(item) ? (
                  <Badge label={t("history.failed")} tone="fail" />
                ) : item.Stopped ? (
                  <Badge label={t("status.stopped")} />
                ) : (
                  <View style={[styles.dot, { backgroundColor: p.okSolid }]} />
                )}
                <Caption>{[clock(item.Started, lang), runLength(item, t)].filter(Boolean).join(" · ")}</Caption>
              </Press>
            )}
          </ListPiece>
        )}
      />
      <Sheet open={filtering} title={t("history.filter")} onClose={() => setFiltering(false)}>
        <AxisLabel>{t("history.runs")}</AxisLabel>
        {/* The middle choice never fits beside the other two at a phone's width,
            so the three stand under each other rather than two and one. */}
        <Choice<RunShow>
          hue={1}
          perRow={1}
          value={show}
          onChange={setShow}
          options={(Object.keys(RUN_SHOW_LABEL) as RunShow[]).map((value) => ({
            value,
            label: t(RUN_SHOW_LABEL[value]),
          }))}
        />
        <JobChips names={names} job={job} onJob={setJob} />
      </Sheet>
      <RunSheet opened={opened} jobs={configs} onClose={() => setOpened(null)} />
    </>
  );
}

/**
 * The findings closed in the last thirty days, with how each ended, as lines
 * in one card. Anomalies keeps only what is open.
 */
function FindingLog({ mode, onMode }: { mode: Mode; onMode: (next: Mode) => void }) {
  const { t, lang } = useT();
  const { p, accent } = useTheme();
  const [closed, setClosed] = useState<Finding[] | null>(null);
  const [known, setKnown] = useState<Job[]>([]);
  const [level, setLevel] = useState<Severity | "">("");
  const [job, setJob] = useState("");
  const [sort, setSort] = useState<Sort>({ by: "since", dir: "desc" });
  const [filtering, setFiltering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [found, jobs] = await Promise.all([api.anomalies(), api.jobs()]);
      setClosed(found.closed);
      setKnown(jobs);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const names = useMemo(
    () => jobNamesInOrder((closed ?? []).map((f) => f.job), known.map((j) => j.name)),
    [closed, known],
  );
  const shown = (closed ?? [])
    .filter((f) => (!job || f.job === job) && (!level || f.severity === level))
    .filter((f) => !typed.trim() || matchesQuery(typed, [f.job, f.detail ?? "", ...(f.paths ?? [])]))
    .sort(findingOrder(sort));

  const narrowing = [
    ...(level ? [t(SEVERITY_LABEL[level])] : []),
    ...(job ? [t("list.onlyJob", { job })] : []),
    ...(typed.trim() ? [t("list.searched", { q: typed.trim() })] : []),
  ];
  const header = (
    <>
      <Top mode={mode} onMode={onMode}>
        <Narrowed
          what={narrowing}
          onClear={() => {
            setLevel("");
            setJob("");
            setTyped("");
          }}
        />
      </Top>
      <ListTop title={t("history.findings")} hue={0} />
      <ListPiece>
        <ListSearch
          open={searching}
          value={typed}
          onChange={setTyped}
          onClose={() => setSearching(false)}
          placeholder={t("history.runSearch")}
        />
        <ListHead
          page="history-findings"
          sort={sort}
          onSort={(by, dir) => setSort({ by, dir })}
          onSearch={() => setSearching(true)}
          heads={[
            {
              id: "severity",
              label: t("list.head.severity"),
              sorts: true,
              filter: { active: level !== "" || job !== "", open: () => setFiltering(true) },
            },
            { id: "job", label: t("history.filterJob"), sorts: true },
            { id: "since", label: t("anomaly.closedLabel"), sorts: true },
          ]}
        />
      </ListPiece>
    </>
  );

  return (
    <>
      <MovingList
        style={{ backgroundColor: p.background }}
        data={shown}
        keyExtractor={(f) => f.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={accent} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <ListPiece>
            <Empty
              title={closed === null ? t("history.working") : narrowing.length > 0 ? t("list.noneShown") : t("anomaly.noneClosed")}
              detail={error || undefined}
            />
          </ListPiece>
        }
        ItemSeparatorComponent={Separator}
        ListFooterComponent={<ListEnd />}
        renderItem={({ item: f }) => (
          <ListPiece>
            <View style={styles.row}>
              <Caption>
                {[t(SEVERITY_LABEL[f.severity]), f.job, f.outcome ? t(`anomaly.outcome.${f.outcome}`) : "", f.closed ? clock(f.closed, lang) : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </Caption>
              <Body>{sentence(f, t, jobSides(known, f.job, t))}</Body>
            </View>
          </ListPiece>
        )}
      />
      <Sheet open={filtering} title={t("history.filter")} onClose={() => setFiltering(false)}>
        <AxisLabel>{t("list.head.severity")}</AxisLabel>
        <Choice<Severity | "">
          hue={1}
          value={level}
          onChange={setLevel}
          options={[
            { value: "", label: t("anomalies.all") },
            ...SEVERITIES.map((sv) => ({ value: sv, label: t(SEVERITY_LABEL[sv]) })),
          ]}
        />
        <JobChips names={names} job={job} onJob={setJob} />
      </Sheet>
    </>
  );
}

/** The card's name: what the list holds, which of it, and the job it is narrowed to. */
function viewName(what: string, which: string, job: string): string {
  return [what, which, job].filter(Boolean).join(" · ");
}

/**
 * The selector between files, runs and, while Anomalies is on, the findings
 * closed lately, over what narrows the list.
 */
function Top({ mode, onMode, children }: { mode: Mode; onMode: (next: Mode) => void; children: ReactNode }) {
  const { t } = useT();
  const { anomaliesOn } = useWaiting();
  return (
    <View style={styles.bar}>
      <Choice<Mode>
        hue={0}
        value={mode}
        onChange={onMode}
        options={[
          { value: "files", label: t("history.files") },
          { value: "runs", label: t("history.runs") },
          ...(anomaliesOn !== false ? [{ value: "findings" as const, label: t("history.findings") }] : []),
        ]}
      />
      {children}
    </View>
  );
}

/**
 * What one run did, path by path, in a sheet over the list. The entries are
 * fetched only when it opens, since the list needs nothing but the summaries.
 */
function RunSheet({ opened, jobs, onClose }: { opened: Opened | null; jobs: Job[]; onClose: () => void }) {
  const { t, lang, spell } = useT();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setEntries(null);
    setError("");
    if (!opened) return;
    api.runEntries(opened.id).then(setEntries, (e: Error) => setError(e.message));
  }, [opened]);

  const groups = new Map<string, Entry[]>();
  for (const entry of entries ?? []) {
    const list = groups.get(entry.Kind) ?? [];
    list.push(entry);
    groups.set(entry.Kind, list);
  }
  const run = opened?.run;
  const length = run ? runLength(run, t) : null;

  return (
    <Sheet open={opened !== null} title={opened?.job ?? ""} onClose={onClose} centred>
      {run ? (
        <>
          <Caption>{clock(run.Started, lang)}</Caption>
          {length ? <Pair label={t("overview.duration")} value={length} /> : null}
          <Body>{failed(run) ? failureLine(run.Err, run.Failure, t, lang) : counters(run, t, lang)}</Body>
          {run.Stopped ? <Caption>{t("history.stopped")}</Caption> : null}
        </>
      ) : null}
      {error ? <Body>{error}</Body> : null}
      {!error && entries === null ? <Caption>{t("history.working")}</Caption> : null}
      {entries?.length === 0 ? <Body>{t("phone.runEmpty")}</Body> : null}
      {[...groups.entries()].map(([kind, list]) => (
        <View key={kind} style={styles.group}>
          <AxisLabel>{`${groupWord(t, kind, list)} · ${list.length}`}</AxisLabel>
          {list.slice(0, 50).map((entry, i) => {
            const labelled = { Kind: entry.Kind, Side: entry.Side ?? "", Note: entry.Note, Path: entry.Path, Code: entry.Code, Vars: entry.Vars };
            const way = opened ? fileWay({ ...labelled, Job: opened.job }, jobs, t) : null;
            const note = entryNote(t, labelled, spell);
            return (
              <View key={`${entry.Path}-${i}`}>
                <Mono>{entry.Path}</Mono>
                {way ? <FileWay way={way} /> : null}
                {/* Among the paths left alone, a folder nobody could read is named as one. */}
                {unreadFolder(labelled) ? <Caption>{entryLabel(t, labelled, undefined, [])}</Caption> : null}
                {note ? <Caption>{note}</Caption> : null}
              </View>
            );
          })}
          {list.length > 50 ? <Caption>{t("trash.more", { total: list.length, shown: 50 })}</Caption> : null}
        </View>
      ))}
    </Sheet>
  );
}

/**
 * One run on one row beside the side bar, as the web's run list draws it:
 * the job, a badge for whatever went otherwise than planned, how long it took,
 * and the time with the green dot of a run that went through.
 */
function RunRowAcross({ run, onPress }: { run: Run; onPress: () => void }) {
  const { t, lang } = useT();
  const { p } = useTheme();
  const fine = !failed(run) && !run.Stopped && run.Conflicts === 0;
  return (
    <Press onPress={onPress} accessibilityRole="button" style={[styles.row, styles.across]}>
      <Text style={[styles.runName, { color: p.text }]}>{run.Job}</Text>
      <View style={[styles.badges, { width: RUN_COLUMNS.state }]}>
        {failed(run) ? <Badge label={t("history.failed")} tone="fail" /> : null}
        {run.Stopped ? <Badge label={t("status.stopped")} /> : null}
        {run.Conflicts > 0 ? <Badge label={capitalized(t("history.conflicts", { count: run.Conflicts }), lang)} tone="warn" /> : null}
        {run.Skipped > 0 ? <Badge label={capitalized(t("history.left", { count: run.Skipped }), lang)} /> : null}
      </View>
      <View style={{ width: RUN_COLUMNS.took }}>
        <Caption>{runLength(run, t) ?? ""}</Caption>
      </View>
      <View style={[styles.when, { width: RUN_COLUMNS.when }]}>
        {fine ? <View style={[styles.dot, { backgroundColor: p.okSolid }]} /> : null}
        <Caption>{clock(run.Started, lang)}</Caption>
      </View>
    </Press>
  );
}

/**
 * Where a file went, in the names the job's card gives its sides: both with
 * the arrow between them, as the job's way line draws it, or the one side a
 * deletion or a rename happened on. A long name is cut at its end so the line
 * keeps to one row.
 */
function FileWay({ way }: { way: { from: string; to: string } | { on: string } }) {
  const { t, rtl } = useT();
  const { p } = useTheme();
  const name = [styles.place, { color: p.textSub }];
  if ("on" in way) {
    return (
      <Text style={name} numberOfLines={1}>
        {t("entry.inPlace", { place: way.on })}
      </Text>
    );
  }
  return (
    <View style={styles.way} accessible accessibilityLabel={t("entry.fromTo", { from: way.from, to: way.to })}>
      <Text style={name} numberOfLines={1}>
        {way.from}
      </Text>
      <Glyph name={rtl ? "IconToLeft" : "IconToRight"} color={p.textMuted} size={14} />
      <Text style={name} numberOfLines={1}>
        {way.to}
      </Text>
    </View>
  );
}

/** A hairline between two rows of the one card. */
function Separator() {
  const { p } = useTheme();
  return (
    <ListPiece>
      <View style={[styles.separator, { backgroundColor: p.border }]} />
    </ListPiece>
  );
}

// A folder that could not be read is a warning: nothing in it was touched.
function tone(item: Touch): "ok" | "warn" | "fail" | "neutral" {
  if (unreadFolder({ Kind: item.Kind, Side: item.Side ?? "", Note: item.Note })) return "warn";
  if (item.Kind === "skip") return "fail";
  if (item.Kind === "conflict") return "warn";
  return "neutral";
}


export function counters(run: Run, t: T, lang: string): string {
  const parts = runFigures(run, t, lang);
  if (parts.length === 0) {
    if (isPerfectlyIdle(run.ID, run.Unchanged)) return t("history.perfectlyIdle");
    return t("preview.identical", { count: run.Unchanged });
  }
  return parts.join(", ");
}

const styles = StyleSheet.create({
  // No gap: the rows are pieces of one card.
  list: { padding: space.lg },
  bar: { gap: space.sm },
  row: { paddingVertical: space.md, gap: space.xs },
  runRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  runName: { flex: 1, fontSize: text.body, fontWeight: "600" },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  wayLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  way: { flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1, minWidth: 0 },
  place: { fontSize: text.subline, lineHeight: 18, flexShrink: 1 },
  // A row that wraps, so the badge starts under the column's head and the
  // way goes beside it or, when the names are long, on a line of its own.
  what: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs },
  // The list head's gap, so the cells stand under their heads.
  across: { flexDirection: "row", alignItems: "center", gap: space.md },
  grow: { flex: 1, minWidth: 0, gap: space.xs },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs },
  when: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  separator: { height: StyleSheet.hairlineWidth, opacity: 0.6 },
  group: { gap: space.xs },
});
