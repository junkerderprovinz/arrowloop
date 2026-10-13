import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { entryLabel, entryNote, plainKey } from "../../../web/src/lib/entryLabel";
import { failureLine } from "../../../web/src/lib/failure";
import { api, failed, touched, type Entry, type Job, type Run, type Touch } from "../api";
import { isPerfectlyIdle } from "../eggs";
import { Glyph } from "../glyphs";
import { useT, type T } from "../i18n";
import { contrastOn, space, text, TOUCH } from "../theme";
import { useEngineEvents } from "../useEngine";
import {
  AxisLabel,
  Badge,
  Body,
  Button,
  Caption,
  Choice,
  Empty,
  ListEnd,
  ListPiece,
  ListTop,
  Mono,
  MovingList,
  Press,
  Sheet,
  useTheme,
} from "../ui";
import { clock } from "../clock";
import { bytes } from "../space";

/**
 * The history tab: a log of every file touched, and a list of runs behind a
 * selector. The runs stay because a run that fails before touching anything
 * writes no file lines. Filter, Sort and Search stand above the list, the list
 * is one card named after what it shows, and a row opens its run in a sheet.
 */
export function History() {
  const [mode, setMode] = useState<Mode>("files");
  return mode === "files" ? <FileLog mode={mode} onMode={setMode} /> : <RunLog mode={mode} onMode={setMode} />;
}

type Mode = "files" | "runs";

type Order = "newest" | "oldest" | "az" | "za";

const ORDERS: { value: Order; key: "phone.sortNewest" | "phone.sortOldest" | "phone.sortAz" | "phone.sortZa" }[] = [
  { value: "newest", key: "phone.sortNewest" },
  { value: "oldest", key: "phone.sortOldest" },
  { value: "az", key: "phone.sortAz" },
  { value: "za", key: "phone.sortZa" },
];

/** Orders rows by their time or their name, either way round. */
function ordered<R>(rows: R[], order: Order, time: (r: R) => string, name: (r: R) => string): R[] {
  const out = [...rows];
  if (order === "az" || order === "za") out.sort((a, b) => name(a).localeCompare(name(b)));
  else out.sort((a, b) => time(b).localeCompare(time(a)));
  if (order === "oldest" || order === "za") out.reverse();
  return out;
}

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
  const { t, lang } = useT();
  const { p, accent } = useTheme();

  const [rows, setRows] = useState<Touch[] | null>(null);
  const [jobs, setJobs] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Job[]>([]);
  const [drives, setDrives] = useState<{ id: string; label: string }[]>([]);
  const [job, setJob] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [order, setOrder] = useState<Order>("newest");
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

  const load = useCallback(async () => {
    try {
      setRows(await api.log({ job, contains: query, kinds: SHOWS[show], limit }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [job, query, show, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  // Job names from both the configuration and the log: a deleted job still has
  // lines, and a job that never ran has none.
  useEffect(() => {
    api.jobs().then(
      (list) => {
        setJobs(list.map((j) => j.name));
        setConfigs(list);
      },
      () => setJobs([]),
    );
    // Only for a drive's name in a badge; without it the badge shows the id.
    api.volumes().then(
      (v) => setDrives(v.volumes),
      () => {},
    );
  }, []);
  const names = useMemo(() => {
    const seen = new Set(jobs);
    for (const r of rows ?? []) seen.add(r.Job);
    seen.delete("");
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [jobs, rows]);

  useThrottledEvents(load);

  const shown = useMemo(
    () => ordered(rows ?? [], order, (r) => r.When, (r) => r.Path),
    [rows, order],
  );

  const header = (
    <>
      <ListBar
        mode={mode}
        onMode={onMode}
        filters={(show === "all" ? 0 : 1) + (job ? 1 : 0)}
        order={order}
        onOrder={setOrder}
        query={typed}
        onQuery={setTyped}
        filter={
          <>
            <AxisLabel>{t("history.files")}</AxisLabel>
            <Choice<Show>
              hue={1}
              value={show}
              onChange={setShow}
              options={(Object.keys(SHOWS) as Show[]).map((value) => ({ value, label: t(SHOW_LABEL[value]) }))}
            />
            <JobChips names={names} job={job} onJob={setJob} />
          </>
        }
      />
      <ListTop title={viewName(t("history.files"), t(SHOW_LABEL[show]), job)} hue={0} />
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
        renderItem={({ item }) => (
          <ListPiece>
            <Press onPress={() => setOpened({ id: item.Run, job: item.Job })} accessibilityRole="button" style={styles.row}>
              <Mono>{item.Path}</Mono>
              <View style={styles.meta}>
                <Badge
                  label={entryLabel(
                    t,
                    { Kind: item.Kind, Side: item.Side ?? "", Note: item.Note, Path: item.Path },
                    configs.find((c) => c.name === item.Job),
                    drives,
                  )}
                  tone={tone(item.Kind)}
                />
                {item.Job ? <Caption>{item.Job}</Caption> : null}
                <Caption>{clock(item.When, lang)}</Caption>
                {item.Size ? <Caption>{bytes(item.Size)}</Caption> : null}
              </View>
              {/* Why a path was skipped, or the name a renamed file had. */}
              {shownNote(t, item) ? <Caption>{shownNote(t, item)}</Caption> : null}
            </Press>
          </ListPiece>
        )}
      />
      <RunSheet opened={opened} onClose={() => setOpened(null)} />
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
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [show, setShow] = useState<RunShow>("all");
  const [job, setJob] = useState("");
  const [order, setOrder] = useState<Order>("newest");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<Opened | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await api.history(100));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useThrottledEvents(load);

  const names = useMemo(() => [...new Set((runs ?? []).map((r) => r.Job))].sort((a, b) => a.localeCompare(b)), [runs]);

  const shown = useMemo(() => {
    const needle = typed.trim().toLowerCase();
    const kept = (runs ?? []).filter(
      (r) =>
        (show === "all" || (show === "failed" ? failed(r) : touched(r) > 0)) &&
        (!job || r.Job === job) &&
        (!needle || r.Job.toLowerCase().includes(needle)),
    );
    return ordered(kept, order, (r) => r.Started, (r) => r.Job);
  }, [runs, show, job, typed, order]);

  const header = (
    <>
      <ListBar
        mode={mode}
        onMode={onMode}
        filters={(show === "all" ? 0 : 1) + (job ? 1 : 0)}
        order={order}
        onOrder={setOrder}
        query={typed}
        onQuery={setTyped}
        filter={
          <>
            <AxisLabel>{t("history.runs")}</AxisLabel>
            <Choice<RunShow>
              hue={1}
              value={show}
              onChange={setShow}
              options={(Object.keys(RUN_SHOW_LABEL) as RunShow[]).map((value) => ({
                value,
                label: t(RUN_SHOW_LABEL[value]),
              }))}
            />
            <JobChips names={names} job={job} onJob={setJob} />
          </>
        }
      />
      <ListTop title={viewName(t("history.runs"), t(RUN_SHOW_LABEL[show]), job)} hue={0} />
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
              ) : (
                <View style={[styles.dot, { backgroundColor: p.okSolid }]} />
              )}
              <Caption>{clock(item.Started, lang)}</Caption>
            </Press>
          </ListPiece>
        )}
      />
      <RunSheet opened={opened} onClose={() => setOpened(null)} />
    </>
  );
}

/** The card's name: what the list holds, which of it, and the job it is narrowed to. */
function viewName(what: string, which: string, job: string): string {
  return [what, which, job].filter(Boolean).join(" · ");
}

/**
 * The selector between files and runs, and under it Filter, Sort and Search as
 * three buttons of equal weight. Filter and Sort open sheets; Search turns
 * into the field it stands for and back into a button when it is closed.
 */
function ListBar({
  mode,
  onMode,
  filters,
  filter,
  order,
  onOrder,
  query,
  onQuery,
}: {
  mode: Mode;
  onMode: (next: Mode) => void;
  /** How many filters narrow the list, said on the button. */
  filters: number;
  /** The filter sheet's content. */
  filter: ReactNode;
  order: Order;
  onOrder: (next: Order) => void;
  query: string;
  onQuery: (next: string) => void;
}) {
  const { t } = useT();
  const { p, corners } = useTheme();
  const [sheet, setSheet] = useState<"filter" | "sort" | null>(null);
  const [searching, setSearching] = useState(query !== "");

  return (
    <View style={styles.bar}>
      <Choice<Mode>
        hue={0}
        value={mode}
        onChange={onMode}
        options={[
          { value: "files", label: t("history.files") },
          { value: "runs", label: t("history.runs") },
        ]}
      />
      {searching ? (
        <View style={styles.tools}>
          <TextInput
            value={query}
            onChangeText={onQuery}
            autoFocus
            placeholder={t("history.pathHint")}
            placeholderTextColor={p.textMuted}
            accessibilityLabel={t("phone.search")}
            style={[styles.search, { backgroundColor: p.surface2, color: p.text, ...corners.control }]}
          />
          <Button
            label={t("common.close")}
            labelKey="common.close"
            wide={false}
            onPress={() => {
              onQuery("");
              setSearching(false);
            }}
          />
        </View>
      ) : (
        <View style={styles.tools}>
          <View style={styles.tool}>
            <Button
              label={filters > 0 ? `${t("history.filter")} (${filters})` : t("history.filter")}
              labelKey="history.filter"
              onPress={() => setSheet("filter")}
            />
          </View>
          <View style={styles.tool}>
            <Button label={t("phone.sort")} glyph="IconSort" onPress={() => setSheet("sort")} />
          </View>
          <View style={styles.tool}>
            <Button label={t("phone.search")} glyph="IconSearch" onPress={() => setSearching(true)} />
          </View>
        </View>
      )}

      <Sheet open={sheet === "filter"} title={t("history.filter")} onClose={() => setSheet(null)}>
        {filter}
      </Sheet>
      <Sheet open={sheet === "sort"} title={t("phone.sort")} onClose={() => setSheet(null)}>
        {ORDERS.map((o) => (
          <Press
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: order === o.value }}
            onPress={() => {
              onOrder(o.value);
              setSheet(null);
            }}
            style={[
              styles.option,
              { backgroundColor: order === o.value ? p.surface2 : "transparent", ...corners.control },
            ]}
          >
            <Text style={[styles.optionText, { color: p.text }]}>{t(o.key)}</Text>
            {order === o.value ? <Glyph name="IconCheck" color={p.text} size={16} /> : null}
          </Press>
        ))}
      </Sheet>
    </View>
  );
}

/** Job chips for the filter sheet; they scroll sideways, since any number of jobs can exist. */
function JobChips({ names, job, onJob }: { names: string[]; job: string; onJob: (next: string) => void }) {
  const { t } = useT();
  if (names.length < 2) return null;
  return (
    <>
      <AxisLabel>{t("nav.jobs")}</AxisLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={t("history.allJobs")} on={job === ""} onPress={() => onJob("")} />
        {names.map((n) => (
          <Chip key={n} label={n} on={job === n} onPress={() => onJob(n)} />
        ))}
      </ScrollView>
    </>
  );
}

/**
 * What one run did, path by path, in a sheet over the list. The entries are
 * fetched only when it opens, since the list needs nothing but the summaries.
 */
function RunSheet({ opened, onClose }: { opened: Opened | null; onClose: () => void }) {
  const { t, lang } = useT();
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

  return (
    <Sheet open={opened !== null} title={opened?.job ?? ""} onClose={onClose}>
      {run ? (
        <>
          <Caption>{clock(run.Started, lang)}</Caption>
          <Body>{failed(run) ? failureLine(run.Err, run.Failure, t, lang) : counters(run, t)}</Body>
        </>
      ) : null}
      {error ? <Body>{error}</Body> : null}
      {!error && entries === null ? <Caption>{t("history.working")}</Caption> : null}
      {entries?.length === 0 ? <Body>{t("phone.runEmpty")}</Body> : null}
      {[...groups.entries()].map(([kind, list]) => (
        <View key={kind} style={styles.group}>
          <AxisLabel>{`${entryWord(kind, t)} · ${list.length}`}</AxisLabel>
          {list.slice(0, 50).map((entry, i) => (
            <Mono key={`${entry.Path}-${i}`}>{entry.Path}</Mono>
          ))}
          {list.length > 50 ? <Caption>{t("trash.more", { total: list.length, shown: 50 })}</Caption> : null}
        </View>
      ))}
    </Sheet>
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

/**
 * A pressable filter pill. It has a Badge's shape but is its own component,
 * since badges only report.
 */
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { p, corners, accent } = useTheme();
  return (
    <Press
      onPress={onPress}
      android_ripple={{ color: p.hover }}
      style={[styles.chip, { backgroundColor: on ? accent : p.surface2, ...corners.pill }]}
    >
      <Text numberOfLines={1} style={[styles.chipText, { color: on ? contrastOn(accent) : p.textSub }]}>
        {label}
      </Text>
    </Press>
  );
}

/**
 * Reloads on engine events at most once a second, since a run sends an event
 * per file.
 */
function useThrottledEvents(load: () => void) {
  const latest = useRef(load);
  latest.current = load;
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);

  useEngineEvents(true, () => {
    const now = Date.now();
    if (now - last.current >= 1000) {
      last.current = now;
      latest.current();
      return;
    }
    // A trailing call, so the last event of a burst is not dropped.
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      last.current = Date.now();
      latest.current();
    }, 1000);
  });
}

function tone(kind: string): "ok" | "warn" | "fail" | "neutral" {
  if (kind === "skip") return "fail";
  if (kind === "conflict") return "warn";
  return "neutral";
}

/** The note beside a file log line, or null when its label already says it. */
function shownNote(t: T, item: Touch): string | null {
  return entryNote(t, { Kind: item.Kind, Side: item.Side ?? "", Note: item.Note });
}

/** An entry kind in its plain word, or the kind itself for one this build does not know. */
function entryWord(kind: string, t: T): string {
  const key = plainKey(kind);
  return key ? t(key) : kind;
}

export function counters(run: Run, t: T): string {
  const parts: string[] = [];
  const add = (n: number, key: "history.copied" | "history.moved" | "history.trashed" | "history.conflicts") => {
    if (n > 0) parts.push(t(key, { count: n }));
  };
  add(run.Copied, "history.copied");
  add(run.Moved, "history.moved");
  add(run.Trashed, "history.trashed");
  add(run.Conflicts, "history.conflicts");
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
  tools: { flexDirection: "row", alignItems: "stretch", gap: space.sm },
  // Equal thirds, whatever the words.
  tool: { flex: 1, minWidth: 0 },
  search: { flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, fontSize: text.body },
  option: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md },
  optionText: { flex: 1, fontSize: text.body },
  chips: { gap: space.sm, paddingVertical: space.xs },
  chip: { paddingHorizontal: space.md, paddingVertical: space.xs },
  chipText: { fontSize: text.meta, fontWeight: "600" },
  row: { paddingVertical: space.md, gap: space.xs },
  runRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  runName: { flex: 1, fontSize: text.body, fontWeight: "600" },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  separator: { height: StyleSheet.hairlineWidth, opacity: 0.6 },
  group: { gap: space.xs },
});
