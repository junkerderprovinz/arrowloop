import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { api, type Job } from "../api";
import { LearningRings } from "../learningRings";
import { clock } from "../clock";
import { useT } from "../i18n";
import type { MoreStack } from "../nav";
import { jobSides } from "../sides";
import { contrastOn, space, text } from "../theme";
import { useEngineStream } from "../useEngine";
import {
  SEVERITIES,
  countBySeverity,
  figures,
  leadingAnswer,
  sentence,
  type Finding,
  type FindingListing,
  type JobLearning,
  type Severity,
} from "../../../web/src/lib/anomalies";
import { sayFailure, type Failure } from "../../../web/src/lib/failure";
import type { TranslationKey } from "../i18n";
import {
  AxisLabel,
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Empty,
  InfoBubble,
  Mono,
  Page,
  Pair,
  Press,
  Section,
  Title,
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

/** How many of the files a brake counted a card names; the rest are counted. */
const SHOWN_FILES = 10;

/**
 * What the engine found about the jobs, laid out as the web's Anomalies page:
 * chips that count and pick a severity, every open finding as a card of its
 * own with its figures and answers, and what was closed lately. Nothing opens
 * over the page.
 */
export function Anomalies() {
  const { t, lang } = useT();
  const nav = useNavigation();
  const focus = useRoute<RouteProp<MoreStack, "Anomalies">>().params?.job;
  const [job, setJob] = useState(focus ?? "");
  const [listing, setListing] = useState<FindingListing | null>(null);
  const [learning, setLearning] = useState<JobLearning[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [picked, setPicked] = useState<Severity | null>(null);
  const [error, setError] = useState("");
  // The jobs whose refused change was let run, and have not answered yet.
  const allowed = useRef(new Set<string>());

  useEffect(() => setJob(focus ?? ""), [focus]);

  const load = useCallback(async () => {
    try {
      const [found, known] = await Promise.all([api.anomalies(), api.jobs()]);
      setListing(found);
      setJobs(known);
      setLearning(await api.learning().catch(() => []));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
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

  const runNow = (name: string) => {
    api.run(name).catch((e: Error) => setError(e.message));
  };

  // The job's own screen sits in the jobs tab, which this screen may not be in.
  const openJob = (name: string) =>
    nav.getParent()?.navigate("JobsTab", { screen: "JobDetail", params: { name } });

  if (!listing) return <Empty title={t("history.working")} detail={error || undefined} />;

  const mine = (f: Finding) => !job || f.job === job;
  const open = listing.open.filter(mine);
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const shown = open
    .filter((f) => !picked || f.severity === picked)
    .sort((a, b) => rank(a.severity) - rank(b.severity) || a.job.localeCompare(b.job));
  const closed = listing.closed.filter(mine);

  return (
    <Page>
      {job ? (
        <View style={styles.chip}>
          <Caption>{t("list.onlyJob", { job })}</Caption>
          <Button label={t("list.everyJob")} glyph="IconClose" wide={false} onPress={() => setJob("")} />
        </View>
      ) : null}

      <Tiles
        counts={countBySeverity(open)}
        picked={picked}
        onPick={(severity) => setPicked((old) => (old === severity ? null : severity))}
      />

      {error ? <Body>{error}</Body> : null}

      {open.length === 0 ? (
        <Body muted>{t("anomaly.none")}</Body>
      ) : shown.length === 0 ? (
        <Body muted>{t("anomaly.noneShown")}</Body>
      ) : null}

      {shown.map((f) => (
        <FindingCard
          key={f.id}
          finding={f}
          places={jobSides(jobs, f.job, t)}
          onAnswer={(how) => answer(f, how)}
          onAcknowledge={() => acknowledge(f)}
          onRun={() => runNow(f.job)}
          onOpenJob={() => openJob(f.job)}
        />
      ))}

      {!picked && learning.length > 0 ? (
        <Section title={t("anomaly.learn.title")} hint={t("anomaly.learn.hint")} hue={1}>
          <LearningRings learning={learning.filter((l) => !job || l.job === job)} onOpen={openJob} />
        </Section>
      ) : null}

      {/* What was closed is only read, so it stands as lines in one card. */}
      <Section title={`${t("anomaly.closed")} · ${closed.length}`} hue={0}>
        {closed.length === 0 ? <Body muted>{t("anomaly.noneClosed")}</Body> : null}
        {closed.map((f) => (
          <View key={f.id} style={styles.closed}>
            <Caption>
              {[f.job, f.outcome ? t(`anomaly.outcome.${f.outcome}`) : "", f.closed ? clock(f.closed, lang) : ""]
                .filter(Boolean)
                .join(" · ")}
            </Caption>
            <Body>{sentence(f, t, jobSides(jobs, f.job, t))}</Body>
          </View>
        ))}
      </Section>
    </Page>
  );
}

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

/**
 * One open finding with everything it has to say and its answers: how bad it
 * is, the job, what happened, the figures, the engine's words for a failure,
 * the files a brake counted, and the way out. A held job has two answers, run
 * or take back, with the one usually meant last; a note is acknowledged or the
 * job is run. Every button is quiet, since a button inside a card is never the
 * screen's accent. Every card starts at the height of the plainest one, and a
 * card with more to say opens in place.
 */
function FindingCard({
  finding: f,
  places,
  onAnswer,
  onAcknowledge,
  onRun,
  onOpenJob,
}: {
  finding: Finding;
  places: [string, string];
  onAnswer: (how: "run" | "back") => void;
  onAcknowledge: () => void;
  onRun: () => void;
  onOpenJob: () => void;
}) {
  const { t, lang } = useT();
  const { p } = useTheme();
  const edge: Record<Severity, string> = { critical: p.failSolid, warning: p.warnSolid, info: p.surface3 };
  const paths = (f.paths ?? []).slice(0, SHOWN_FILES);
  const unnamed = (f.count ?? 0) - paths.length;
  const shown = figures(f, t);
  const failed = f.kind === "failing" && !!f.detail;
  const [expanded, setExpanded] = useState(false);
  // Whether the sentence runs past two lines, which is more to say on its own.
  const [cut, setCut] = useState(false);
  const more = shown.length > 0 || failed || paths.length > 0 || cut;

  const open = <Button key="open" label={t("anomaly.openJob")} labelKey="anomaly.openJob" onPress={onOpenJob} />;
  let answers;
  if (f.kind === "unusual") {
    // The run already happened, so there is nothing to run again.
    answers = [
      <Button key="ack" label={t("anomaly.acknowledge")} labelKey="anomaly.acknowledge" onPress={onAcknowledge} />,
      open,
    ];
  } else if (f.held) {
    const run = <Button key="run" label={t("anomaly.run")} labelKey="anomaly.run" onPress={() => onAnswer("run")} />;
    const back = (
      <Button key="back" label={t("anomaly.restore")} labelKey="anomaly.restore" onPress={() => onAnswer("back")} />
    );
    answers = leadingAnswer(f) === "run" ? [open, back, run] : [open, run, back];
  } else {
    answers = [
      <Button key="ack" label={t("anomaly.acknowledge")} labelKey="anomaly.acknowledge" onPress={onAcknowledge} />,
      open,
      <Button key="run" label={t("jobs.runNow")} labelKey="jobs.runNow" onPress={onRun} />,
    ];
  }

  return (
    <Card style={[styles.finding, { borderStartColor: edge[f.severity] }]}>
      <View style={styles.badges}>
        <Badge label={t(`anomaly.severity.${f.severity}`)} tone={BADGE_TONE[f.severity]} />
        {f.held ? (
          <View style={styles.held}>
            <Badge label={t("anomaly.held")} tone="warn" />
            <InfoBubble tip={t("anomaly.heldHint")} />
          </View>
        ) : null}
      </View>
      <Title>{f.job}</Title>
      <Caption>
        {`${t(`anomaly.kind.${f.kind}`)} · ${t("anomaly.sinceLabel")} ${clock(f.since, lang)}`}
      </Caption>
      <Body
        lines={expanded ? undefined : 2}
        onTextLayout={(e) => {
          if (!expanded && e.nativeEvent.lines.length > 2) setCut(true);
        }}
      >
        {sentence(f, t, places)}
      </Body>
      {expanded ? (
        <>
          {shown.map(([term, value]) => (
            <Pair key={term} label={term} value={value} />
          ))}
          {/* What the last failure was about, which names the cause. */}
          {failed && f.detail ? <Failed raw={f.detail} failure={f.failure} /> : null}
          {paths.length > 0 ? (
            <View style={styles.files}>
              <AxisLabel hint={t("anomaly.filesHint")}>{t("anomaly.files")}</AxisLabel>
              {paths.map((path) => (
                <Mono key={path}>{path}</Mono>
              ))}
              {unnamed > 0 ? <Caption>{t("anomaly.filesMore", { count: unnamed })}</Caption> : null}
            </View>
          ) : null}
        </>
      ) : null}
      <View style={styles.answers}>
        {more ? (
          <Button
            label={t(expanded ? "anomaly.showLess" : "anomaly.showMore")}
            labelKey={expanded ? "anomaly.showLess" : "anomaly.showMore"}
            onPress={() => setExpanded((was) => !was)}
          />
        ) : null}
        {answers}
      </View>
      <View style={styles.hints}>
        {f.held ? (
          <InfoBubble tip={`${t("anomaly.run")}: ${t("anomaly.runHint")}\n\n${t("anomaly.restore")}: ${t("anomaly.restoreHint")}`} />
        ) : (
          <InfoBubble tip={t("anomaly.acknowledgeHint")} />
        )}
      </View>
    </Card>
  );
}

/** Why a job keeps failing: the sentence, and under it the engine's own words where they still tell something. */
function Failed({ raw, failure }: { raw: string; failure?: Failure }) {
  const { t, lang } = useT();
  const { said, engine } = sayFailure(raw, failure, t, lang);
  return (
    <>
      <Body>{said}</Body>
      {engine ? <Mono>{engine}</Mono> : null}
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
  },
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
  finding: {
    borderStartWidth: 3,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
  },
  held: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  files: {
    gap: 2,
  },
  closed: {
    gap: 2,
  },
  answers: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: space.sm,
  },
  hints: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
});
