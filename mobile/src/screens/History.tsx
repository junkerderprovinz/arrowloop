import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { entryLabel } from "../../../web/src/lib/entryLabel";
import { api, failed, touched, type Job, type Run, type Touch } from "../api";
import { isPerfectlyIdle } from "../eggs";
import { Field } from "../fields";
import { Glyph } from "../glyphs";
import { useT, type T } from "../i18n";
import type { HistoryStack, Nav } from "../nav";
import { contrastOn, space, text } from "../theme";
import { useEngineEvents } from "../useEngine";
import { Badge, Body, Button, Caption, Card, Choice, Empty, Mono, Title, useTheme } from "../ui";
import { when } from "./Jobs";
import { bytes } from "../space";

/**
 * The history tab: a log of every file touched, and a list of runs behind a
 * switch. The runs stay because a run that fails before touching anything
 * writes no file lines.
 */
export function History() {
  const [mode, setMode] = useState<"files" | "runs">("files");

  return mode === "files" ? (
    <FileLog mode={mode} onMode={setMode} />
  ) : (
    <RunLog mode={mode} onMode={setMode} />
  );
}

function Mode({ value, onChange }: { value: "files" | "runs"; onChange: (next: "files" | "runs") => void }) {
  const { t } = useT();
  return (
    <Choice
      value={value}
      onChange={onChange}
      options={[
        { value: "files", label: t("history.files") },
        { value: "runs", label: t("history.runs") },
      ]}
    />
  );
}

/**
 * The log switch and the button that unfolds the filters, which start folded
 * so the list stays on the first screen. The button counts the active filters
 * and takes the accent, so a narrowed list always says so.
 */
function FilterBar({
  mode,
  onMode,
  open,
  onOpen,
  active,
}: {
  mode: "files" | "runs";
  onMode: (next: "files" | "runs") => void;
  open: boolean;
  onOpen: (next: boolean) => void;
  active: number;
}) {
  const { t } = useT();
  return (
    <View style={styles.filterBar}>
      <View style={styles.filterMode}>
        <Mode value={mode} onChange={onMode} />
      </View>
      <Button
        label={active > 0 ? `${t("history.filter")} (${active})` : t("history.filter")}
        onPress={() => onOpen(!open)}
        tone={active > 0 ? "accent" : "neutral"}
        wide={false}
      />
    </View>
  );
}

/**
 * The entry kinds behind each segment of the "show" filter. A failure is a
 * `skip` carrying its reason; there is no separate error kind.
 */
const SHOWS = {
  all: [] as string[],
  copied: ["copy", "move"],
  gone: ["trash", "rmdir"],
  trouble: ["conflict", "skip"],
};

type Show = keyof typeof SHOWS;

/**
 * Every file the engine has touched, newest first. The engine does the
 * filtering, since the screen holds only the newest page of a long log.
 */
function FileLog({ mode, onMode }: { mode: "files" | "runs"; onMode: (next: "files" | "runs") => void }) {
  const nav = useNavigation<Nav<HistoryStack>>();
  const { t } = useT();
  const { p, radius, accent } = useTheme();

  const [rows, setRows] = useState<Touch[] | null>(null);
  const [jobs, setJobs] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Job[]>([]);
  const [drives, setDrives] = useState<{ id: string; label: string }[]>([]);
  const [job, setJob] = useState("");
  const [show, setShow] = useState<Show>("all");
  // The search is debounced, so the engine sees one query per pause rather
  // than one per keystroke.
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  // Doubles as the list scrolls, rather than paging.
  const [limit, setLimit] = useState(60);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

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

  // Counts the debounced query, not what is still being typed.
  const active = (query ? 1 : 0) + (show === "all" ? 0 : 1) + (job ? 1 : 0);

  const header = (
    <View style={styles.filters}>
      <FilterBar mode={mode} onMode={onMode} open={open} onOpen={setOpen} active={active} />
      {open ? (
        <>
          <Field
            label={t("jobs.activitySearch")}
            value={typed}
            onChange={setTyped}
            placeholder={t("history.pathHint")}
          />
          <Choice<Show>
            value={show}
            onChange={setShow}
            options={[
              { value: "all", label: t("history.everything") },
              { value: "copied", label: t("history.onlyCopied") },
              { value: "gone", label: t("history.onlyGone") },
              { value: "trouble", label: t("history.onlyTrouble") },
            ]}
          />
          {/* Job chips scroll sideways, since any number of jobs can exist. */}
          {names.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <Chip label={t("history.allJobs")} on={job === ""} onPress={() => setJob("")} />
              {names.map((n) => (
                <Chip key={n} label={n} on={job === n} onPress={() => setJob(n)} />
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </View>
  );

  if (!rows) {
    return (
      <FlatList
        style={{ backgroundColor: p.background }}
        data={[]}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={<Empty title={t("history.working")} detail={error || undefined} />}
        renderItem={null}
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: p.background }}
      data={rows}
      keyExtractor={(r, i) => `${r.Run}-${r.Path}-${i}`}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={accent} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Empty
          title={query ? t("jobs.activityNoMatch", { q: query }) : t("history.logEmpty")}
          detail={error || undefined}
        />
      }
      ListFooterComponent={error ? <Caption>{error}</Caption> : null}
      // Only an answer that filled the limit can have more behind it.
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (rows.length >= limit) setLimit((n) => n * 2);
      }}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => nav.navigate("RunDetail", { id: item.Run, job: item.Job })}
          android_ripple={{ color: p.hover }}
          style={[styles.row, { backgroundColor: p.surface, borderRadius: radius.control }]}
        >
          <Mono>{item.Path}</Mono>
          <View style={styles.meta}>
            <Badge
              label={entryLabel(
                t,
                { Kind: item.Kind, Side: item.Side ?? "" },
                configs.find((c) => c.name === item.Job),
                drives,
              )}
              tone={tone(item.Kind)}
            />
            {/* The arrow points at the side that was written to. */}
            {item.Side === "left" || item.Side === "right" ? (
              <Glyph
                name={item.Side === "left" ? "IconToLeft" : "IconToRight"}
                color={p.textSub}
                size={16}
              />
            ) : null}
            {item.Job ? <Caption>{item.Job}</Caption> : null}
            <Caption>{`${when(item.When, t)} ${t("jobs.ago")}`}</Caption>
            {item.Size ? <Caption>{bytes(item.Size)}</Caption> : null}
          </View>
          {/* Why a path was skipped, or which way a conflict went. */}
          {item.Note ? <Caption>{item.Note}</Caption> : null}
        </Pressable>
      )}
    />
  );
}

/**
 * The runs, newest first, each showing only its non-zero counters or, when
 * nothing changed, a sentence saying so.
 */
function RunLog({ mode, onMode }: { mode: "files" | "runs"; onMode: (next: "files" | "runs") => void }) {
  const nav = useNavigation<Nav<HistoryStack>>();
  const { t } = useT();
  const { p, accent } = useTheme();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [show, setShow] = useState<"all" | "changed" | "failed">("all");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

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

  // Filtered locally, unlike the file log: a hundred runs is a small list.
  const shown = useMemo(() => {
    if (!runs) return [];
    if (show === "failed") return runs.filter(failed);
    if (show === "changed") return runs.filter((r) => touched(r) > 0);
    return runs;
  }, [runs, show]);

  const header = (
    <View style={styles.filters}>
      <FilterBar
        mode={mode}
        onMode={onMode}
        open={open}
        onOpen={setOpen}
        active={show === "all" ? 0 : 1}
      />
      {open ? (
        <Choice
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: t("history.showAll") },
            { value: "changed", label: t("history.showChanged") },
            { value: "failed", label: t("history.showFailed") },
          ]}
        />
      ) : null}
    </View>
  );

  if (!runs) {
    return (
      <FlatList
        style={{ backgroundColor: p.background }}
        data={[]}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={<Empty title={t("history.loading")} detail={error || undefined} />}
        renderItem={null}
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: p.background }}
      data={shown}
      keyExtractor={(r) => String(r.ID)}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={accent} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Empty
          title={runs.length === 0 ? t("history.empty") : t("history.noMatch")}
          detail={runs.length === 0 ? t("history.nothing") : undefined}
        />
      }
      ListFooterComponent={error ? <Caption>{error}</Caption> : null}
      renderItem={({ item }) => (
        <Card onPress={() => nav.navigate("RunDetail", { id: item.ID, job: item.Job })}>
          <View style={styles.head}>
            <Title>{item.Job}</Title>
            {failed(item) ? (
              <Badge label={t("history.failed")} tone="fail" />
            ) : touched(item) > 0 ? (
              <Badge label={t("history.ok")} tone="ok" />
            ) : null}
            {/* An idle run gets no badge; the line below already says so. */}
          </View>
          <Caption>{`${when(item.Started, t)} ${t("jobs.ago")}`}</Caption>
          {failed(item) ? (
            <Body>{item.Err}</Body>
          ) : (
            <Body>{counters(item, t)}</Body>
          )}
        </Card>
      )}
    />
  );
}

/**
 * A pressable filter pill. It has a Badge's shape but is its own component,
 * since badges only report.
 */
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { p, radius, accent } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: p.hover }}
      style={[styles.chip, { backgroundColor: on ? accent : p.surface2, borderRadius: radius.pill }]}
    >
      <Text numberOfLines={1} style={[styles.chipText, { color: on ? contrastOn(accent) : p.textSub }]}>
        {label}
      </Text>
    </Pressable>
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

/** Returns the translation key for an entry kind; RunDetail uses it too. */
export function entryKey(
  kind: string,
):
  | "entry.copy"
  | "entry.move"
  | "entry.trash"
  | "entry.conflict"
  | "entry.mkdir"
  | "entry.rmdir"
  | "entry.skip"
  | "entry.other" {
  switch (kind) {
    case "copy":
      return "entry.copy";
    case "move":
      return "entry.move";
    case "trash":
    case "delete":
      return "entry.trash";
    case "conflict":
      return "entry.conflict";
    case "mkdir":
      return "entry.mkdir";
    case "rmdir":
      return "entry.rmdir";
    case "skip":
      return "entry.skip";
    default:
      return "entry.other";
  }
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
  list: { padding: space.lg, gap: space.md },
  filters: { gap: space.sm },
  // The switch grows to the button's touch height rather than squashing it.
  filterBar: { flexDirection: "row", alignItems: "stretch", gap: space.sm },
  filterMode: { flex: 1 },
  chips: { gap: space.sm, paddingVertical: space.xs },
  chip: { paddingHorizontal: space.md, paddingVertical: space.xs },
  chipText: { fontSize: text.caption, fontWeight: "600" },
  // A log line is a plain surface rather than a card.
  row: { padding: space.md, gap: space.xs },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
});
