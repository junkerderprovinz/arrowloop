import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { entryLabel, transferLabel } from "../../web/src/lib/entryLabel";
import type { Job, Moving, Touch } from "./api";
import { clock } from "./clock";
import { Glyph } from "./glyphs";
import { useT } from "./i18n";
import { animateNext, useMotion } from "./motion";
import { STEPS_KEPT, type Progress } from "./progress";
import { remoteOf } from "./sides";
import { bytes } from "./space";
import { space, text } from "./theme";
import { Caption, Meter, Press, Section, useHue, useTheme } from "./ui";

/**
 * How often the rows may change. A run over many small files finishes dozens a
 * second; they are counted by the run's bar in the card above, and a row that
 * stands for less than this cannot be read.
 */
const ROW_MS = 500;

/** One row: a file in transfer, one a run has just finished, or one from the log. */
interface Line {
  key: string;
  job: string;
  kind: string;
  path: string;
  side?: string;
  note?: string;
  /** Set while the file is in transfer. */
  moving?: Moving;
  /** Set on a file from the log, which says when it was touched. */
  when?: string;
}

/**
 * The rows to show, newest first. While a run works on files, its files in
 * transfer lead and the ones it just finished follow, across every running
 * job. Otherwise, the last files the log holds.
 */
function activityLines(progress: Record<string, Progress>, touches: Touch[] | null): Line[] {
  const live: Line[] = [];
  const done: (Line & { at: number })[] = [];
  for (const [job, at] of Object.entries(progress)) {
    const finished = new Set(at.steps.map((s) => `${s.kind}\n${s.path}`));
    // By path, since rclone lists its transfers in no lasting order.
    const moving = [...at.moving].sort((a, b) => a.path.localeCompare(b.path));
    for (const m of moving) {
      // The frame that drops a finished file can come after the step that
      // reports it.
      if (finished.has(`copy\n${m.path}`)) continue;
      live.push({ key: `${job}\ncopy\n${m.path}`, job, kind: "copy", path: m.path, side: m.side, moving: m });
    }
    for (const s of at.steps) {
      done.push({ key: `${job}\n${s.kind}\n${s.path}`, job, kind: s.kind, path: s.path, side: s.side, note: s.note, at: s.at });
    }
  }
  done.sort((a, b) => b.at - a.at);
  const now = [...live, ...done];
  if (now.length > 0) return now.slice(0, STEPS_KEPT);
  return (touches ?? []).slice(0, STEPS_KEPT).map((e) => ({
    key: `${e.Run}\n${e.Kind}\n${e.Path}`,
    job: e.Job,
    kind: e.Kind,
    path: e.Path,
    side: e.Side,
    note: e.Note,
    when: e.When,
  }));
}

/**
 * The files being worked on across every running job: what happens to each,
 * a bar while it is in transfer and a tick once it is done. While nothing runs
 * it lists the last files a run touched, with when. It is left out until there
 * is a file to name. Each row leads to its job.
 */
export function Activity({
  progress,
  touches,
  jobs,
  hue,
  onOpen,
}: {
  progress: Record<string, Progress>;
  touches: Touch[] | null;
  jobs: Job[];
  /** The card's position among the page's cards. */
  hue: number;
  onOpen: (job: string) => void;
}) {
  const { t } = useT();
  const lines = useCalm(useMemo(() => activityLines(progress, touches), [progress, touches]));
  if (lines.length === 0) return null;
  return (
    <Section title={t("history.files")} hint={t("overview.filesHint")} hue={hue}>
      {lines.map((line) => {
        const index = jobs.findIndex((j) => j.name === line.job);
        return (
          <Row key={line.key} line={line} job={jobs[index]} index={Math.max(index, 0)} onOpen={() => onOpen(line.job)} />
        );
      })}
    </Section>
  );
}

/**
 * Lets the rows change at most every ROW_MS, always ending on the latest. A
 * row that comes or goes fades at the motion level in force, and not at all
 * under reduce motion.
 */
function useCalm(lines: Line[]): Line[] {
  const { intensity } = useMotion();
  const [shown, setShown] = useState(lines);
  const was = useRef(shown);
  const last = useRef(0);
  useEffect(() => {
    const show = () => {
      last.current = Date.now();
      if (keys(lines) !== keys(was.current)) animateNext(intensity, "fade");
      was.current = lines;
      setShown(lines);
    };
    const wait = last.current + ROW_MS - Date.now();
    if (wait <= 0) {
      show();
      return;
    }
    const timer = setTimeout(show, wait);
    return () => clearTimeout(timer);
  }, [lines, intensity]);
  return shown;
}

function keys(lines: Line[]): string {
  return lines.map((l) => l.key).join("\n\n");
}

function Row({ line, job, index, onOpen }: { line: Line; job: Job | undefined; index: number; onOpen: () => void }) {
  const { t, lang } = useT();
  const { p } = useTheme();
  // The job's colour, as its bar wears it in the job list and the card above.
  const hue = useHue(index);
  const moving = line.moving;
  const sized = moving !== undefined && moving.size > 0;
  const label = moving
    ? transferLabel(t, line.side, job, [])
    : entryLabel(t, { Kind: line.kind, Side: line.side ?? "", Note: line.note, Path: line.path }, job, []);
  const facts = [label, line.job];
  // The share done stands beside the name; where the service did not say how
  // big the file is, what has arrived so far stands here instead.
  if (moving) facts.push(bytes(sized ? moving.size : moving.bytes));
  if (line.when) facts.push(clock(line.when, lang));

  return (
    <Press onPress={onOpen} accessibilityRole="button" style={styles.row}>
      <View style={styles.top}>
        <Glyph name={glyphOf(line, job)} color={p.textSub} size={GLYPH} />
        <FileName path={line.path} />
        {sized ? (
          <Text style={[styles.share, { color: p.textSub }]}>
            {new Intl.NumberFormat(lang, { style: "percent" }).format(moving.bytes / moving.size)}
          </Text>
        ) : !moving && !line.when ? (
          <Glyph name="IconCheck" color={p.okInk} size={14} />
        ) : null}
      </View>
      <View style={styles.under}>
        <Caption>{facts.join(" · ")}</Caption>
        {sized ? <Meter done={moving.bytes} total={moving.size} hue={hue} /> : null}
      </View>
    </Press>
  );
}

/**
 * A path on one line with its folder dimmed. A long one loses its middle,
 * since the top folder and the file's own name are what tell files apart.
 */
function FileName({ path }: { path: string }) {
  const { p } = useTheme();
  const cut = path.lastIndexOf("/") + 1;
  return (
    <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.name, { color: p.text }]}>
      {cut > 0 ? <Text style={{ color: p.textMuted }}>{path.slice(0, cut)}</Text> : null}
      {path.slice(cut)}
    </Text>
  );
}

/**
 * The mark for what happens to a file. A copy goes up when it lands on a
 * target from the device and down the other way round; between two folders
 * or two targets it is a copy. A file that left for the other side, which
 * internal/apply notes as `relocated`, is marked by where it went.
 */
function glyphOf(line: Line, job: Job | undefined): string {
  switch (line.kind) {
    case "copy":
      return landing(line.side, job) ?? "IconCopy";
    case "move":
      if (line.note === "relocated") return landing(line.side === "left" ? "right" : "left", job) ?? "IconCopy";
      return "IconPencil";
    case "trash":
    case "delete":
      return "IconTrash";
    default:
      return "IconConflict";
  }
}

function landing(side: string | undefined, job: Job | undefined): string | undefined {
  if (!job || (side !== "left" && side !== "right")) return undefined;
  const [to, from] = side === "left" ? [job.left, job.right] : [job.right, job.left];
  const up = Boolean(remoteOf(to));
  if (up === Boolean(remoteOf(from))) return undefined;
  return up ? "IconUpload" : "IconDownload";
}

const GLYPH = 16;

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: space.xs },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  // Under the name rather than under the mark.
  under: { marginStart: GLYPH + space.sm, gap: space.xs },
  name: { flex: 1, minWidth: 0, fontSize: text.body },
  share: { fontSize: text.subline, fontVariant: ["tabular-nums", "lining-nums"] },
});
