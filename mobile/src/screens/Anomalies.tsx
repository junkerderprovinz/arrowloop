import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { api, type Config, type Job } from "../api";
import { NumberField } from "../fields";
import { useT } from "../i18n";
import type { MoreStack } from "../nav";
import { settings } from "../settings";
import { jobSides } from "../sides";
import { contrastOn, space, text } from "../theme";
import { useEngineStream } from "../useEngine";
import {
  SEVERITIES,
  countBySeverity,
  figures,
  globalBrakes,
  groupFindings,
  leadingAnswer,
  ownBrakes,
  sentence,
  shortLine,
  type Brakes,
  type Finding,
  type FindingGroup,
  type FindingListing,
  type Severity,
} from "../../../web/src/lib/anomalies";
import type { TranslationKey } from "../i18n";
import {
  AxisLabel,
  Badge,
  Body,
  Button,
  Caption,
  Empty,
  InfoBubble,
  Mono,
  Page,
  Pair,
  Press,
  Row,
  Section,
  Sheet,
  Toggle,
  useTheme,
} from "../ui";

const TILE_LABEL: Record<Severity, TranslationKey> = {
  critical: "anomaly.severity.critical",
  warning: "anomaly.tile.warning",
  info: "anomaly.tile.info",
};

const BADGE_TONE: Record<Severity, "fail" | "warn" | "neutral"> = {
  critical: "fail",
  warning: "warn",
  info: "neutral",
};

/** How many file names an opened finding lists; the count beside them is the whole number. */
const SHOWN_PATHS = 50;

type OwnBrakes = Pick<Brakes, "brakePercent" | "changePercent">;

/** What a sheet over the page shows: one finding, or one job's brakes. */
type Opened =
  | { kind: "finding"; finding: Finding; places: [string, string]; closed?: boolean }
  | { kind: "monitoring"; job: string };

/**
 * What the engine found about the jobs, laid out as the web's Anomalies page:
 * three tiles that count and pick, a card per job with open findings, the jobs
 * without any, and what was closed lately. Nothing folds open in place: a
 * finding and a job's brakes open in a sheet.
 */
export function Anomalies() {
  const { t } = useT();
  const focus = useRoute<RouteProp<MoreStack, "Anomalies">>().params?.job;
  const [listing, setListing] = useState<FindingListing | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [global, setGlobal] = useState<Brakes>(() => globalBrakes(undefined));
  const [picked, setPicked] = useState<Severity | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState("");
  // The jobs whose refused change was let run, and have not answered yet.
  const allowed = useRef(new Set<string>());
  // Another screen sent somebody here for one job's finding, which opens once.
  const focused = useRef(false);

  const load = useCallback(async () => {
    try {
      const [found, known] = await Promise.all([api.anomalies(), api.jobs()]);
      setListing(found);
      setJobs(known);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    api.config().then(setConfig, () => {});
    settings.read().then(
      (got) => setGlobal(globalBrakes(got.defaults as Partial<Brakes> | undefined)),
      () => {},
    );
  }, [load]);

  useEffect(() => {
    if (!listing || !focus || focused.current) return;
    focused.current = true;
    const first = groupFindings(listing.open.filter((f) => f.job === focus))[0]?.findings[0];
    if (first) setOpened({ kind: "finding", finding: first, places: jobSides(jobs, focus, t) });
  }, [listing, focus, jobs, t]);

  useEngineStream(true, (event) => {
    if (event.phase !== "finished" && event.phase !== "anomaly") return;
    // The permission covers what was shown. A job the brake refuses again
    // after it was given has changed since, and says so.
    if (event.phase === "finished" && allowed.current.delete(event.job) && event.held) {
      setError(t("anomaly.heldAgain", { job: event.job }));
    }
    void load();
  });

  const setOwn = async (name: string, own: OwnBrakes | null) => {
    if (!config) return;
    const next: Config = {
      ...config,
      jobs: config.jobs.map((j) => {
        if (j.name !== name) return j;
        const { brakePercent: _b, changePercent: _c, ...rest } = j;
        return own ? { ...rest, ...own } : rest;
      }),
    };
    setConfig(next);
    try {
      await api.writeConfig(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const answer = (finding: Finding, how: "run" | "back") => {
    const places = jobSides(jobs, finding.job, t);
    const empty = places[finding.side === "right" ? 1 : 0];
    const message =
      how === "run"
        ? `${sentence(finding, t, places)} ${t("anomaly.runHint")}`
        : finding.kind === "empty"
          ? `${t("anomaly.restoreEmpty", { place: empty })} ${t("anomaly.restoreHint")}`
          : t("anomaly.restoreHint");
    const title =
      how === "run" ? t("anomaly.runAsk", { job: finding.job }) : t("anomaly.restoreAsk", { job: finding.job });
    Alert.alert(title, message, [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t(how === "run" ? "anomaly.run" : "anomaly.restore"),
        onPress: () => {
          setError("");
          if (how === "run") allowed.current.add(finding.job);
          api.answerAnomaly(finding.id, how).then(load, (e: Error) => setError(e.message));
        },
      },
    ]);
  };

  const acknowledge = (finding: Finding) => {
    api.acknowledgeAnomaly(finding.id).then(load, (e: Error) => setError(e.message));
  };

  const runNow = (job: string) => {
    api.run(job).catch((e: Error) => setError(e.message));
  };

  if (!listing) return <Empty title={t("history.working")} detail={error || undefined} />;

  const groups = groupFindings(listing.open.filter((f) => !picked || f.severity === picked));
  const loud = new Set(listing.open.map((f) => f.job));
  const quiet = jobs.filter((j) => !loud.has(j.name));
  const brakes: BrakeBook = { config, global, setOwn };
  const openFinding = (finding: Finding, closed?: boolean) =>
    setOpened({ kind: "finding", finding, places: jobSides(jobs, finding.job, t), closed });
  const openMonitoring = (job: string) => setOpened({ kind: "monitoring", job });

  return (
    <Page>
      <Tiles
        counts={countBySeverity(listing.open)}
        picked={picked}
        onPick={(severity) => setPicked((old) => (old === severity ? null : severity))}
      />

      {error ? <Body>{error}</Body> : null}

      {listing.open.length === 0 ? (
        <Body muted>{t("anomaly.none")}</Body>
      ) : groups.length === 0 ? (
        <Body muted>{t("anomaly.noneShown")}</Body>
      ) : null}

      {groups.map((g, i) => (
        <FindingCard
          key={g.job}
          group={g}
          places={jobSides(jobs, g.job, t)}
          hue={i}
          onOpen={(f) => openFinding(f)}
          onMonitoring={() => openMonitoring(g.job)}
          onAnswer={answer}
          onAcknowledge={acknowledge}
          onRun={runNow}
        />
      ))}

      {quiet.length > 0 ? (
        <Section title={`${t("anomaly.quiet")} · ${quiet.length}`} hint={t("anomaly.quietHint")} hue={groups.length}>
          {quiet.map((j) => (
            <Row key={j.name} label={j.name} onPress={() => openMonitoring(j.name)} />
          ))}
        </Section>
      ) : null}

      <Section title={`${t("anomaly.closed")} · ${listing.closed.length}`} hue={groups.length + 1}>
        {listing.closed.length === 0 ? <Body muted>{t("anomaly.noneClosed")}</Body> : null}
        {listing.closed.map((f) => (
          <Line key={f.id} finding={f} places={jobSides(jobs, f.job, t)} closed onPress={() => openFinding(f, true)} />
        ))}
      </Section>

      <Sheet
        open={opened !== null}
        title={
          opened?.kind === "monitoring"
            ? `${opened.job} · ${t("anomaly.monitoring")}`
            : opened
              ? `${opened.finding.job} · ${t(`anomaly.kind.${opened.finding.kind}`)}`
              : ""
        }
        onClose={() => setOpened(null)}
      >
        {opened?.kind === "monitoring" ? <Monitoring job={opened.job} brakes={brakes} /> : null}
        {opened?.kind === "finding" ? (
          <FindingDetail finding={opened.finding} places={opened.places} closed={opened.closed} />
        ) : null}
      </Sheet>
    </Page>
  );
}

type BrakeBook = {
  /** Null until the configuration has been read. */
  config: Config | null;
  global: Brakes;
  setOwn: (job: string, own: OwnBrakes | null) => void;
};

/**
 * The categories count the open findings by severity, as a row of chips, the
 * form tiles take on a phone. A tap picks the findings a chip stands for and a
 * second tap shows them all again; the rest of the page stays.
 */
function Tiles({
  counts,
  picked,
  onPick,
}: {
  counts: Record<Severity, number>;
  picked: Severity | null;
  onPick: (severity: Severity) => void;
}) {
  const { t } = useT();
  const { p, corners, accent } = useTheme();
  const tone: Record<Severity, string> = { critical: p.failInk, warning: p.warnInk, info: p.text };
  return (
    <View style={styles.tiles} accessibilityLabel={t("anomaly.filter")}>
      {SEVERITIES.map((severity) => {
        const on = picked === severity;
        const ink = on ? contrastOn(accent) : undefined;
        return (
          <Press
            key={severity}
            onPress={() => onPick(severity)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            android_ripple={{ color: p.hover }}
            style={[styles.tile, { backgroundColor: on ? accent : p.surface2, ...corners.pill }]}
          >
            <Text style={[styles.tileLabel, { color: ink ?? p.text }]} numberOfLines={1}>
              {t(TILE_LABEL[severity])}
            </Text>
            <Text style={[styles.tileNumber, { color: ink ?? tone[severity] }]}>{counts[severity]}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/** A held job says so on its card and in its finding. */
function HeldNote() {
  const { t } = useT();
  const { p } = useTheme();
  return (
    <View style={styles.held}>
      <Text style={[styles.heldText, { color: p.warnInk }]}>{t("anomaly.held")}</Text>
      <InfoBubble tip={t("anomaly.heldHint")} />
    </View>
  );
}

function FindingCard({
  group,
  places,
  hue,
  onOpen,
  onMonitoring,
  onAnswer,
  onAcknowledge,
  onRun,
}: {
  group: FindingGroup;
  places: [string, string];
  hue: number;
  onOpen: (finding: Finding) => void;
  onMonitoring: () => void;
  onAnswer: (finding: Finding, how: "run" | "back") => void;
  onAcknowledge: (finding: Finding) => void;
  onRun: (job: string) => void;
}) {
  const { t } = useT();
  const held = group.findings.find((f) => f.held);
  const lead = held ? leadingAnswer(held) : undefined;

  // A held job has two answers, run or take back; a note is acknowledged or
  // the job is run. The one usually meant stands last. Both are quiet, since a
  // button inside a card is never the screen's accent.
  const run = held ? (
    <Button key="run" label={t("anomaly.run")} labelKey="anomaly.run" onPress={() => onAnswer(held, "run")} />
  ) : null;
  const restore = held ? (
    <Button
      key="restore"
      label={t("anomaly.restore")}
      labelKey="anomaly.restore"
      onPress={() => onAnswer(held, "back")}
    />
  ) : null;

  return (
    <Section title={group.job} hue={hue}>
      <View style={styles.cardHead}>
        <Badge label={t(`anomaly.severity.${group.worst}`)} tone={BADGE_TONE[group.worst]} />
        <Caption>{t("anomaly.open", { count: group.findings.length })}</Caption>
      </View>

      {group.findings.map((f) => (
        <Line key={f.id} finding={f} places={places} onPress={() => onOpen(f)} />
      ))}

      {held ? <HeldNote /> : null}

      <Row label={t("anomaly.monitoring")} onPress={onMonitoring} />

      <View style={styles.answers}>
        {held ? (
          lead === "run" ? [restore, run] : [run, restore]
        ) : (
          <>
            <Button
              label={t("anomaly.acknowledge")}
              labelKey="anomaly.acknowledge"
              onPress={() => group.findings.forEach(onAcknowledge)}
            />
            <Button label={t("jobs.runNow")} labelKey="jobs.runNow" onPress={() => onRun(group.job)} />
          </>
        )}
      </View>
      <View style={styles.hints}>
        {held ? (
          <InfoBubble tip={`${t("anomaly.run")}: ${t("anomaly.runHint")}\n\n${t("anomaly.restore")}: ${t("anomaly.restoreHint")}`} />
        ) : (
          <InfoBubble tip={t("anomaly.acknowledgeHint")} />
        )}
      </View>
    </Section>
  );
}

/**
 * One finding as a line: a dot for its severity and what happened. A tap opens
 * the whole of it in a sheet. The card around it names the job, so only a
 * closed finding's line does.
 */
function Line({
  finding: f,
  places,
  onPress,
  closed,
}: {
  finding: Finding;
  places: [string, string];
  onPress: () => void;
  closed?: boolean;
}) {
  const { t } = useT();
  const { p } = useTheme();
  const dot: Record<Severity, string> = { critical: p.failSolid, warning: p.warnSolid, info: p.textMuted };
  return (
    <Press onPress={onPress} accessibilityRole="button" android_ripple={{ color: p.hover }} style={styles.line}>
      <View style={[styles.dot, { backgroundColor: dot[f.severity] }]} />
      <Text style={[styles.lineText, { color: p.text }]}>
        {closed ? <Text style={styles.lineJob}>{`${f.job}: `}</Text> : null}
        <Text style={{ color: p.textSub }}>{`${t(`anomaly.kind.${f.kind}`)}: `}</Text>
        {shortLine(f, t, places)}
      </Text>
    </Press>
  );
}

/** A finding in full: the sentence, the figures, the engine's words and the files. */
function FindingDetail({
  finding: f,
  places,
  closed,
}: {
  finding: Finding;
  places: [string, string];
  closed?: boolean;
}) {
  const { t } = useT();
  const paths = (f.paths ?? []).slice(0, SHOWN_PATHS);
  const more = (f.count ?? 0) - paths.length;
  return (
    <>
      {closed && f.outcome ? <Caption>{t(`anomaly.outcome.${f.outcome}`)}</Caption> : null}
      <Body>{sentence(f, t, places)}</Body>
      {figures(f, t).map(([term, value]) => (
        <Pair key={term} label={term} value={value} />
      ))}
      {/* The engine's own words for a failure, which name the cause. */}
      {f.kind === "failing" && f.detail ? <Mono>{f.detail}</Mono> : null}
      {!closed && paths.length > 0 ? (
        <View style={styles.files}>
          <AxisLabel hint={t("anomaly.filesHint")}>{t("anomaly.files")}</AxisLabel>
          {paths.map((path) => (
            <Mono key={path}>{path}</Mono>
          ))}
          {more > 0 ? <Caption>{t("anomaly.filesMore", { count: more })}</Caption> : null}
        </View>
      ) : null}
      {!closed && f.held ? <HeldNote /> : null}
    </>
  );
}

/** A job's brakes: the global ones it follows, or its own two values. */
function Monitoring({ job, brakes }: { job: string; brakes: BrakeBook }) {
  const { t } = useT();
  const own = ownBrakes(
    brakes.config?.jobs.find((j) => j.name === job),
    brakes.global,
  );
  const global: OwnBrakes = {
    brakePercent: brakes.global.brakePercent,
    changePercent: brakes.global.changePercent,
  };
  // An empty box is a value being typed, so it writes nothing.
  const set = (key: keyof OwnBrakes, text: string) => {
    const value = Number(text.replace(/[^\d]/g, ""));
    if (!text.trim() || Number.isNaN(value)) return;
    brakes.setOwn(job, { ...(own ?? global), [key]: Math.min(100, value) });
  };

  return (
    <View style={styles.monitoring}>
      {!own ? (
        <Caption>
          {t("anomaly.follows", {
            delete: brakes.global.brakePercent,
            change: brakes.global.changePercent,
            floor: brakes.global.brakeFloor,
          })}
        </Caption>
      ) : null}
      <Toggle
        label={t("anomaly.ownBrakes")}
        hint={t("anomaly.ownBrakesHint")}
        value={own !== null}
        disabled={!brakes.config}
        onChange={(on) => brakes.setOwn(job, on ? global : null)}
      />
      {own ? (
        <>
          <NumberField
            label={t("engine.brakePercent")}
            hint={t("engine.brakePercentHint")}
            value={String(own.brakePercent)}
            onChange={(v) => set("brakePercent", v)}
          />
          <NumberField
            label={t("engine.changePercent")}
            hint={t("engine.changePercentHint")}
            value={String(own.changePercent)}
            onChange={(v) => set("changePercent", v)}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space.sm,
  },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.md,
  },
  tileNumber: {
    fontSize: text.body,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  tileLabel: {
    fontSize: text.body,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 44,
  },
  lineText: {
    flex: 1,
    fontSize: text.body,
    lineHeight: 20,
  },
  lineJob: {
    fontWeight: "600",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  files: {
    gap: 2,
  },
  held: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heldText: {
    fontSize: text.meta,
  },
  monitoring: {
    gap: space.sm,
  },
  answers: {
    flexDirection: "row",
    gap: space.sm,
  },
  hints: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
});
