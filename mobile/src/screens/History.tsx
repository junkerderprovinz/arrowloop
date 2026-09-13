import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, failed, touched, type Run, type Touch } from "../api";
import { Field } from "../fields";
import { Glyph } from "../glyphs";
import { useT, type T } from "../i18n";
import type { HistoryStack, Nav } from "../nav";
import { contrastOn, space, text } from "../theme";
import { useEngineEvents } from "../useEngine";
import { Badge, Body, Caption, Card, Choice, Empty, Mono, Title, useTheme } from "../ui";
import { when } from "./Jobs";
import { bytes } from "./Targets";

/**
 * What has happened - file by file, and run by run.
 *
 * jdp: "in Autosync sieht man jede einzelne datei im Verlauf, es ist wie ein
 * log, das möchte ich in AL auch haben. Können wir es so machen? Eventuell mit
 * Filterfunktion etc."
 *
 * So FILES are what this tab opens on, because that is the question somebody
 * actually arrives with: where did that photo go, and when. A list of runs
 * answers it only by opening runs one at a time until the right one is found.
 *
 * The runs did not go away, and that is not sentiment: a run that fails before
 * it touches anything - an unreachable target, a drive that is not plugged in -
 * writes NO file lines at all. A tab that only showed files would hide exactly
 * the failure somebody most needs to see. So the two live under one switch,
 * files first.
 */
export function History() {
  const [mode, setMode] = useState<"files" | "runs">("files");

  return mode === "files" ? (
    <FileLog mode={mode} onMode={setMode} />
  ) : (
    <RunLog mode={mode} onMode={setMode} />
  );
}

/** The switch between the two, drawn identically above either list. */
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
 * The kinds behind each segment of the "show" filter.
 *
 * Grouped rather than one segment per kind: there are nine kinds and a phone
 * holds four segments. The grouping is by what somebody is looking FOR - things
 * that arrived, things that went away, and things that went wrong - which is
 * the question, rather than by the engine's own vocabulary.
 *
 * `skip` is under trouble because that is what it means here: a path the engine
 * decided not to touch and wrote the reason for. There is no "error" kind - a
 * failure is a skip carrying its reason - so a segment called after one would
 * filter for something no run can produce.
 */
const SHOWS = {
  all: [] as string[],
  copied: ["copy", "move"],
  gone: ["trash", "rmdir"],
  trouble: ["conflict", "skip"],
};

type Show = keyof typeof SHOWS;

/**
 * Every file this engine has touched, newest first, narrowed three ways.
 *
 * Every narrowing is asked of the ENGINE. The log runs to tens of thousands of
 * rows on a watching job and the screen holds a few dozen; filtering an answer
 * that has already arrived would search the newest page rather than the log,
 * which is the difference between "nothing matches" and "nothing matches in the
 * last hundred lines".
 */
function FileLog({ mode, onMode }: { mode: "files" | "runs"; onMode: (next: "files" | "runs") => void }) {
  const nav = useNavigation<Nav<HistoryStack>>();
  const { t } = useT();
  const { p, radius, accent } = useTheme();

  const [rows, setRows] = useState<Touch[] | null>(null);
  const [jobs, setJobs] = useState<string[]>([]);
  const [job, setJob] = useState("");
  const [show, setShow] = useState<Show>("all");
  // What was typed, and what has actually been asked for. Two states because
  // they run at two speeds: the box answers every keystroke, the engine must
  // not - a nine-letter name would otherwise be nine queries over a table with
  // a row per file per run, and the answers can come back out of order.
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  // Doubles on request rather than paging. Somebody looking for when a file was
  // touched wants the list to reach further back, not to be handed page four.
  const [limit, setLimit] = useState(60);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  // Back to one screenful whenever the question changes. Carrying a limit that
  // grew to 960 rows while scrolling into a search for one name asks the engine
  // for nine hundred rows to draw three.
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

  // The job names come from the CONFIGURATION and from the log, joined. A job
  // that was renamed or deleted still has its lines in here and leaving it out
  // would make them unreachable; a job that has never run is in the
  // configuration and not in the log, and leaving that one out means the job
  // somebody suspects of doing nothing cannot be asked about.
  useEffect(() => {
    api.jobs().then(
      (list) => setJobs(list.map((j) => j.name)),
      () => setJobs([]),
    );
  }, []);
  const names = useMemo(() => {
    const seen = new Set(jobs);
    for (const r of rows ?? []) seen.add(r.Job);
    seen.delete("");
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [jobs, rows]);

  useThrottledEvents(load);

  const header = (
    <View style={styles.filters}>
      <Mode value={mode} onChange={onMode} />
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
      {/* The job filter scrolls sideways rather than sharing the four segments
          above it. A segmented strip divides the width it has; a list of jobs
          has no width it can promise, and the fifth job would be three letters
          and an ellipsis. */}
      {names.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t("history.allJobs")} on={job === ""} onPress={() => setJob("")} />
          {names.map((n) => (
            <Chip key={n} label={n} on={job === n} onPress={() => setJob(n)} />
          ))}
        </ScrollView>
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
      // Asks for more when the end comes into view, rather than offering a
      // button. A button at the end of a scrolling list asks somebody to stop
      // reading, aim and tap, to carry on doing what they were already doing.
      // Only when the last answer FILLED the limit, which is the one honest
      // signal that there is more: a shorter list is the whole list.
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
          {/* The path first, and allowed to wrap. It is what somebody came
              here to read, and truncating it hides the part that tells two
              similar files apart. */}
          <Mono>{item.Path}</Mono>
          <View style={styles.meta}>
            <Badge label={t(entryKey(item.Kind))} tone={tone(item.Kind)} />
            {/* Which way it went, drawn rather than spelled: this is the side
                that was WRITTEN to, and a file that landed on the right came
                from the left. */}
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
          {/* Why, where the engine had something to say - the reason a path was
              left alone, or which way a conflict went. It is the whole value of
              a `skip` line and the one thing a count can never carry. */}
          {item.Note ? <Caption>{item.Note}</Caption> : null}
        </Pressable>
      )}
    />
  );
}

/**
 * The runs, newest first: did this run do anything, and did it go wrong.
 *
 * The desktop shows nine counters per run in a table; nine numbers in a row on
 * a phone is a wall, and eight of them are zero on an ordinary night. So the
 * counters are FILTERED to the ones that are not zero, and a run that changed
 * nothing says so in words.
 */
function RunLog({ mode, onMode }: { mode: "files" | "runs"; onMode: (next: "files" | "runs") => void }) {
  const nav = useNavigation<Nav<HistoryStack>>();
  const { t } = useT();
  const { p, accent } = useTheme();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [show, setShow] = useState<"all" | "changed" | "failed">("all");
  const [error, setError] = useState("");

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

  // Filtered HERE rather than by asking again. A hundred runs is a small list
  // and a round trip per tap on a filter is a screen that feels slow for no
  // reason anybody can see. The FILE log opposite does the opposite, and the
  // difference is the size of the thing being filtered.
  const shown = useMemo(() => {
    if (!runs) return [];
    if (show === "failed") return runs.filter(failed);
    if (show === "changed") return runs.filter((r) => touched(r) > 0);
    return runs;
  }, [runs, show]);

  const header = (
    <View style={styles.filters}>
      <Mode value={mode} onChange={onMode} />
      <Choice
        value={show}
        onChange={setShow}
        options={[
          { value: "all", label: t("history.showAll") },
          { value: "changed", label: t("history.showChanged") },
          { value: "failed", label: t("history.showFailed") },
        ]}
      />
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
            {/* A run that changed nothing gets no badge at all, and that is
                the fix rather than a shorter one: the sentence for it is a
                whole sentence, and a whole sentence beside a title is a pill
                as wide as the card with its last word cut off. The counters
                below already say it. */}
          </View>
          <Caption>{`${when(item.Started, t)} ${t("jobs.ago")}`}</Caption>
          {failed(item) ? (
            // The engine's own sentence, not a code. It was written for a
            // person, and replacing it with "an error occurred" is the one way
            // to make a failure less useful than it already is.
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
 * A pill that is a filter rather than a label.
 *
 * Deliberately the Badge's shape and not the Badge itself: a badge REPORTS and
 * this one is pressed. Sharing the component would mean every badge in the app
 * had to grow an onPress nobody else passes, and somebody would eventually
 * press one that reports.
 */
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { p, radius, accent } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: p.hover }}
      style={[styles.chip, { backgroundColor: on ? accent : p.surface2, borderRadius: radius.pill }]}
    >
      {/* Computed against the fill it actually landed on, never a fixed
          contrast: an accent can be far lighter or darker than the last one,
          and reusing one answer is how white text ends up on pale mint. */}
      <Text numberOfLines={1} style={[styles.chipText, { color: on ? contrastOn(accent) : p.textSub }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Reload on the engine's events, but at most once a second.
 *
 * The stream sends a line per file during a run, and a query per line over a
 * table with a row per file per run is a phone that gets hot showing a log. A
 * second is under the time it takes to read one row and far above the rate the
 * events arrive at.
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
    // A trailing call, so the LAST event of a burst is not the one that gets
    // dropped. Without it a run that finishes inside the quiet second leaves
    // the screen showing the state from just before it ended.
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      last.current = Date.now();
      latest.current();
    }, 1000);
  });
}

/** Which kinds are a problem, so a bad line stands out in a list of good ones. */
function tone(kind: string): "ok" | "warn" | "fail" | "neutral" {
  if (kind === "skip") return "fail";
  if (kind === "conflict") return "warn";
  return "neutral";
}

/**
 * A kind as a translation key.
 *
 * The same table RunDetail uses, and it lives here because both screens draw
 * the same vocabulary: a kind spelled one way in one list and another way in
 * the other is the drift nobody reports and everybody notices.
 */
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
  // The keys carry their own placeholder - `copied: {count}` - so the number
  // goes INSIDE rather than in front. Putting it in front produced
  // "3 kopiert: {count}" on screen, which is the placeholder showing through.
  const add = (n: number, key: "history.copied" | "history.moved" | "history.trashed" | "history.conflicts") => {
    if (n > 0) parts.push(t(key, { count: n }));
  };
  add(run.Copied, "history.copied");
  add(run.Moved, "history.moved");
  add(run.Trashed, "history.trashed");
  add(run.Conflicts, "history.conflicts");
  if (parts.length === 0) return t("preview.identical", { count: run.Unchanged });
  return parts.join(", ");
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md },
  filters: { gap: space.sm },
  chips: { gap: space.sm, paddingVertical: space.xs },
  chip: { paddingHorizontal: space.md, paddingVertical: space.xs },
  chipText: { fontSize: text.caption, fontWeight: "600" },
  // A log line: a surface on the page's ground, not a card. A card is an
  // object somebody acts on; a hundred of them down a log is a hundred objects
  // where there is one list.
  row: { padding: space.md, gap: space.xs },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
});
