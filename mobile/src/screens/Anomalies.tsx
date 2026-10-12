import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { api, type Config, type Job } from "../api";
import { NumberField } from "../fields";
import { useT } from "../i18n";
import type { MoreStack } from "../nav";
import { settings } from "../settings";
import { jobSides } from "../sides";
import { space, text } from "../theme";
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
import { Badge, Body, Button, Caption, Card, Empty, InfoBubble, Mono, Page, Pair, Press, Section, Toggle, useTheme } from "../ui";

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

/**
 * What the engine found about the jobs, laid out as the web's Anomalies page:
 * three tiles that count and filter, a card per job with open findings, the
 * jobs without any, and what was closed lately.
 */
export function Anomalies() {
  const { t } = useT();
  const focus = useRoute<RouteProp<MoreStack, "Anomalies">>().params?.job;
  const [listing, setListing] = useState<FindingListing | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [global, setGlobal] = useState<Brakes>(() => globalBrakes(undefined));
  const [hidden, setHidden] = useState<Set<Severity>>(new Set());
  const [error, setError] = useState("");
  // The jobs whose refused change was let run, and have not answered yet.
  const allowed = useRef(new Set<string>());

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

  const groups = groupFindings(listing.open.filter((f) => !hidden.has(f.severity)));
  const loud = new Set(listing.open.map((f) => f.job));
  const quiet = jobs.filter((j) => !loud.has(j.name));
  const brakes: BrakeBook = { config, global, setOwn };

  return (
    <Page>
      <Tiles
        counts={countBySeverity(listing.open)}
        hidden={hidden}
        onToggle={(severity) =>
          setHidden((old) => {
            const next = new Set(old);
            if (next.has(severity)) next.delete(severity);
            else next.add(severity);
            return next;
          })
        }
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
          opened={focus === g.job}
          brakes={brakes}
          onAnswer={answer}
          onAcknowledge={acknowledge}
          onRun={runNow}
        />
      ))}

      {quiet.length > 0 ? (
        <Section title={`${t("anomaly.quiet")} · ${quiet.length}`} hint={t("anomaly.quietHint")} hue={groups.length}>
          {quiet.map((j) => (
            <QuietRow key={j.name} job={j.name} brakes={brakes} />
          ))}
        </Section>
      ) : null}

      <Closed closed={listing.closed} jobs={jobs} />
    </Page>
  );
}

type BrakeBook = {
  /** Null until the configuration has been read. */
  config: Config | null;
  global: Brakes;
  setOwn: (job: string, own: OwnBrakes | null) => void;
};

/** The fold arrow, pointing along the line and down when open. */
function Disclosure({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12" style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
      <Path fill={color} d="M4 1.3 8.5 6 4 10.7Z" />
    </Svg>
  );
}

/**
 * The tiles count the open findings by severity and are the only filter: a
 * tap hides that severity and a second one brings it back.
 */
function Tiles({
  counts,
  hidden,
  onToggle,
}: {
  counts: Record<Severity, number>;
  hidden: Set<Severity>;
  onToggle: (severity: Severity) => void;
}) {
  const { t } = useT();
  const { p, corners } = useTheme();
  const tone: Record<Severity, string> = { critical: p.failInk, warning: p.warnInk, info: p.text };
  return (
    <View style={styles.tiles} accessibilityLabel={t("anomaly.filter")}>
      {SEVERITIES.map((severity) => {
        const shown = !hidden.has(severity);
        return (
          <Press
            key={severity}
            onPress={() => onToggle(severity)}
            accessibilityRole="button"
            accessibilityState={{ selected: shown }}
            android_ripple={{ color: p.hover }}
            style={[styles.tile, { backgroundColor: p.surface, ...corners.card }]}
          >
            <Text style={[styles.tileNumber, { color: shown ? tone[severity] : p.textMuted }]}>{counts[severity]}</Text>
            <Text style={[styles.tileLabel, { color: shown ? p.text : p.textMuted }]} numberOfLines={1}>
              {t(TILE_LABEL[severity])}
            </Text>
            <Caption>{t(shown ? "anomaly.tile.shown" : "anomaly.tile.hidden")}</Caption>
          </Press>
        );
      })}
    </View>
  );
}

/** A held job says so wherever its finding's line is closed. */
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
  opened,
  brakes,
  onAnswer,
  onAcknowledge,
  onRun,
}: {
  group: FindingGroup;
  places: [string, string];
  hue: number;
  /** Another screen sent somebody here for this job, so its lines start open. */
  opened: boolean;
  brakes: BrakeBook;
  onAnswer: (finding: Finding, how: "run" | "back") => void;
  onAcknowledge: (finding: Finding) => void;
  onRun: (job: string) => void;
}) {
  const { t } = useT();
  const { p } = useTheme();
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(opened ? group.findings.map((f) => f.id) : []));
  const [monitoring, setMonitoring] = useState(false);
  const held = group.findings.find((f) => f.held);
  const lead = held ? leadingAnswer(held) : undefined;

  const toggleLine = (id: string) =>
    setOpenIds((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A held job has two answers, run or take back; a note is acknowledged or
  // the job is run. The one usually meant stands last, in the accent.
  const run = held ? (
    <Button
      key="run"
      label={t("anomaly.run")}
      labelKey="anomaly.run"
      tone={lead === "run" ? "accent" : "neutral"}
      hue={hue}
      onPress={() => onAnswer(held, "run")}
    />
  ) : null;
  const restore = held ? (
    <Button
      key="restore"
      label={t("anomaly.restore")}
      labelKey="anomaly.restore"
      tone={lead === "restore" ? "accent" : "neutral"}
      hue={hue}
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
        <Line key={f.id} finding={f} places={places} open={openIds.has(f.id)} onToggle={() => toggleLine(f.id)} />
      ))}

      {held && !openIds.has(held.id) ? <HeldNote /> : null}

      <Press
        onPress={() => setMonitoring(!monitoring)}
        accessibilityRole="button"
        accessibilityState={{ expanded: monitoring }}
        style={styles.fold}
      >
        <Text style={[styles.foldText, { color: p.textSub }]}>{t("anomaly.monitoring")}</Text>
        <Disclosure open={monitoring} color={p.textSub} />
      </Press>
      {monitoring ? <Monitoring job={group.job} brakes={brakes} /> : null}

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
            <Button
              label={t("jobs.runNow")}
              labelKey="jobs.runNow"
              tone="accent"
              hue={hue}
              onPress={() => onRun(group.job)}
            />
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
 * One finding as a line: a dot for its severity, what happened, and the fold
 * arrow. Opened, it says the whole sentence, the figures and the files. The
 * card around it names the job, so only a closed finding's line does.
 */
function Line({
  finding: f,
  places,
  open,
  onToggle,
  closed,
}: {
  finding: Finding;
  places: [string, string];
  open: boolean;
  onToggle: () => void;
  closed?: boolean;
}) {
  const { t } = useT();
  const { p } = useTheme();
  const [files, setFiles] = useState(false);
  const dot: Record<Severity, string> = { critical: p.failSolid, warning: p.warnSolid, info: p.textMuted };
  const paths = (f.paths ?? []).slice(0, SHOWN_PATHS);
  const more = (f.count ?? 0) - paths.length;

  return (
    <View>
      <Press
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        android_ripple={{ color: p.hover }}
        style={styles.line}
      >
        <View style={[styles.dot, { backgroundColor: dot[f.severity] }]} />
        <Text style={[styles.lineText, { color: p.text }]}>
          {closed ? <Text style={styles.lineJob}>{`${f.job}: `}</Text> : null}
          <Text style={{ color: p.textSub }}>{`${t(`anomaly.kind.${f.kind}`)}: `}</Text>
          {shortLine(f, t, places)}
        </Text>
        <Disclosure open={open} color={p.textSub} />
      </Press>

      {open ? (
        <View style={styles.lineBody}>
          {closed && f.outcome ? <Caption>{t(`anomaly.outcome.${f.outcome}`)}</Caption> : null}
          <Body>{sentence(f, t, places)}</Body>
          {figures(f, t).map(([term, value]) => (
            <Pair key={term} label={term} value={value} />
          ))}
          {/* The engine's own words for a failure, which name the cause. */}
          {f.kind === "failing" && f.detail ? <Mono>{f.detail}</Mono> : null}

          {!closed && paths.length > 0 ? (
            <>
              <View style={styles.filesHead}>
                <Press
                  onPress={() => setFiles(!files)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: files }}
                  style={styles.fold}
                >
                  <Disclosure open={files} color={p.textSub} />
                  <Text style={[styles.foldText, { color: p.textSub }]}>{t("anomaly.files")}</Text>
                </Press>
                <InfoBubble tip={t("anomaly.filesHint")} />
              </View>
              {files ? (
                <View style={styles.files}>
                  {paths.map((path) => (
                    <Mono key={path}>{path}</Mono>
                  ))}
                  {more > 0 ? <Caption>{t("anomaly.filesMore", { count: more })}</Caption> : null}
                </View>
              ) : null}
            </>
          ) : null}

          {!closed && f.held ? <HeldNote /> : null}
        </View>
      ) : null}
    </View>
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

function QuietRow({ job, brakes }: { job: string; brakes: BrakeBook }) {
  const { p } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Press
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        android_ripple={{ color: p.hover }}
        style={styles.line}
      >
        <Text style={[styles.lineText, { color: p.text }]}>{job}</Text>
        <Disclosure open={open} color={p.textSub} />
      </Press>
      {open ? <Monitoring job={job} brakes={brakes} /> : null}
    </View>
  );
}

function Closed({ closed, jobs }: { closed: Finding[]; jobs: Job[] }) {
  const { t } = useT();
  const { p } = useTheme();
  const [open, setOpen] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const toggleLine = (id: string) =>
    setOpenIds((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <Press
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.line}
      >
        <Disclosure open={open} color={p.textSub} />
        <Text style={[styles.lineText, { color: p.text }]}>{t("anomaly.closed")}</Text>
        <Caption>{String(closed.length)}</Caption>
      </Press>
      {open && closed.length === 0 ? <Body muted>{t("anomaly.noneClosed")}</Body> : null}
      {open
        ? closed.map((f) => (
            <Line
              key={f.id}
              finding={f}
              places={jobSides(jobs, f.job, t)}
              closed
              open={openIds.has(f.id)}
              onToggle={() => toggleLine(f.id)}
            />
          ))
        : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: "row",
    gap: space.sm,
  },
  tile: {
    flex: 1,
    padding: space.md,
    gap: 2,
  },
  tileNumber: {
    fontSize: text.status,
    fontWeight: "600",
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
  lineBody: {
    gap: space.sm,
    paddingStart: space.lg,
    paddingBottom: space.sm,
  },
  filesHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  files: {
    gap: 2,
  },
  fold: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
  },
  foldText: {
    fontSize: text.meta,
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
