import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api, type Job, type Remote } from "../api";
import { CardMenu } from "../CardMenu";
import { Glyph, ProviderMark } from "../glyphs";
import { directionKey, markForSide } from "../jobMark";
import { jobCopy } from "../../../web/src/lib/jobCopy.data";
import { useT, type T } from "../i18n";
import { animateNext, useMotion } from "../motion";
import { since } from "../../../web/src/lib/since";
import type { Nav, JobsStack } from "../nav";
import { space } from "../theme";
import { useEngineEvents } from "../useEngine";
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  CardHead,
  Empty,
  Fab,
  FAB_ROOM,
  Floating,
  Title,
  useHue,
  useTheme,
} from "../ui";

/**
 * The job list, one card per job with its state, direction, last success and
 * both paths. Everything else is behind a tap.
 */
export function Jobs() {
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const { p, accent } = useTheme();
  const { intensity: motion } = useMotion();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  /** The targets behind the sides, for the cards' logos. */
  const [remotes, setRemotes] = useState<Remote[]>([]);
  useEffect(() => {
    // Refetched on focus, so a target created in another tab gets its logo.
    const stop = nav.addListener("focus", () => {
      api.storage().then((list) => setRemotes(list.remotes), () => {});
    });
    return stop;
  }, [nav]);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [holding, setHolding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs(await api.jobs());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const stop = nav.addListener("focus", load);
    return stop;
  }, [nav, load]);

  useEngineEvents(true, load);

  // Animates a job starting or stopping. Keyed on the running set, so a
  // refetch of the same jobs does not animate.
  const roster = (jobs ?? []).filter((j) => j.running).map((j) => j.name).join("\n");
  useEffect(() => {
    animateNext(motion);
  }, [roster, motion]);

  const act = async (job: Job) => {
    setBusy(job.name);
    try {
      await (job.running ? api.stop(job.name) : api.run(job.name));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Holds or releases a job by rewriting the whole configuration. It is read
   * fresh, since the list on screen carries live state that must not be saved
   * as settings.
   */
  const hold = async (job: Job) => {
    setHolding(job.name);
    try {
      const config = await api.config();
      await api.writeConfig({
        ...config,
        jobs: config.jobs.map((j) => (j.name === job.name ? { ...j, disabled: !job.disabled } : j)),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHolding(null);
    }
  };

  /** Adds a copy of a job without asking, since deleting the copy undoes it. */
  const duplicate = async (job: Job) => {
    try {
      const config = await api.config();
      const source = config.jobs.find((j) => j.name === job.name);
      if (!source) return;
      const copy = jobCopy(source, config.jobs.map((j) => j.name), t("edit.copySuffix"), t("edit.newJob"));
      await api.writeConfig({ ...config, jobs: [...config.jobs, copy] });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = (job: Job) => {
    Alert.alert(t("edit.removeJob"), t("edit.removeStakes", { name: job.name }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        // Not "destructive": GlimStone paints no delete red, dialogs included.
        onPress: async () => {
          try {
            const config = await api.config();
            await api.writeConfig({
              ...config,
              jobs: config.jobs.filter((j) => j.name !== job.name),
            });
            await load();
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
    ]);
  };

  if (jobs === null) return <Empty title={t("jobs.activityLoading")} detail={error || undefined} />;

  return (
    <Floating>
      <FlatList
      style={{ backgroundColor: p.background }}
      data={jobs}
      keyExtractor={(j) => j.name}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={accent} />}
      // No empty-list text: the add button already makes the offer.
      ListFooterComponent={error ? <Caption>{error}</Caption> : null}
      renderItem={({ item, index }) => (
        <JobCard
          job={item}
          index={index}
          busy={busy === item.name}
          onOpen={() => nav.navigate("JobDetail", { name: item.name })}
          onAct={() => act(item)}
          holding={holding === item.name}
          onHold={() => hold(item)}
          // Opening and editing reach the same screen but stay two menu rows,
          // so somebody looking for "edit" finds it.
          onEdit={() => nav.navigate("JobEdit", { name: item.name })}
          onDuplicate={() => duplicate(item)}
          onRemove={() => remove(item)}
          // Either side can be the target; the right is the usual one.
          mark={markForSide(item.right, remotes) ?? markForSide(item.left, remotes)}
          leftMark={sideMark(item.left, remotes)}
          rightMark={sideMark(item.right, remotes)}
        />
      )}
      />
      <Fab label={t("edit.add")} labelKey="edit.add" onPress={() => nav.navigate("JobEdit", {})} />
    </Floating>
  );
}

function JobCard({
  job,
  index,
  busy,
  onOpen,
  onAct,
  holding,
  onHold,
  onEdit,
  onDuplicate,
  onRemove,
  mark,
  leftMark,
  rightMark,
}: {
  job: Job;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onAct: () => void;
  /** Whether the hold is being written right now. */
  holding: boolean;
  onHold: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /** The target's logo, if the engine could name its product. */
  mark?: string;
  /** The mark in front of each side; see sideMark. */
  leftMark?: string;
  rightMark?: string;
}) {
  const { t } = useT();
  const hue = useHue(index);
  const { p, scheme } = useTheme();
  return (
    <Card onPress={onOpen} hue={hue}>
      <CardHead mark={mark} title={job.name}>
        {job.disabled ? (
          <Badge label={t("jobs.state.disabled")} />
        ) : job.running ? (
          <Badge label={t("jobs.state.running")} tone="accent" />
        ) : job.watch ? (
          <Badge label={t("jobs.cadence.live")} tone="ok" />
        ) : null}
        <View style={styles.menuSlot}>
          <CardMenu
            items={[
              // Open is listed although tapping the card does the same, so it
              // can be found.
              { label: t("action.open"), glyph: "IconPreview", onPress: onOpen },
              { label: t("action.edit"), glyph: "IconEdit", onPress: onEdit },
              // The copy starts held; see jobCopy.data.ts.
              { label: t("edit.duplicate"), glyph: "IconCopy", onPress: onDuplicate },
              { label: t("action.delete"), glyph: "IconDelete", onPress: onRemove },
            ]}
          />
        </View>
      </CardHead>

      {/* Paths wrap rather than truncate, since the cut part is what tells
          two similar jobs apart. */}
      <Side path={job.left} mark={leftMark} />
      <View style={styles.way}>
        <Glyph name={directionGlyph(job.direction)} color={p.textSub} size={22} />
        <Caption>{t(directionKey(job.direction))}</Caption>
      </View>
      <Side path={job.right} mark={rightMark} />

      <Caption>
        {job.lastSuccess
          ? `${t("jobs.lastRun", { when: when(job.lastSuccess, t) })} ${t("jobs.ago")}`
          : t("jobs.activityEmpty")}
      </Caption>

      {/* Two buttons, since a held job can still be started by hand. A
          running job's button cancels the run rather than pausing, which is
          what the hold button does. The control that goes ahead sits on the
          right. */}
      <View style={styles.actions}>
        <Button
          label={job.disabled ? t("jobs.resume") : t("jobs.pause")}
          labelKey={job.disabled ? "jobs.resume" : "jobs.pause"}
          busy={holding}
          onPress={onHold}
        />
        <Button
          label={job.running ? t("jobs.cancelRun") : t("jobs.runNow")}
          labelKey={job.running ? "jobs.cancelRun" : "jobs.runNow"}
          tone={job.running ? "neutral" : "accent"}
          busy={busy}
          onPress={onAct}
        />
      </View>
    </Card>
  );
}

/**
 * One side of a job, its path behind a mark: the phone glyph for a path on
 * this device, the provider's mark for a target, and an empty slot when the
 * product is unknown.
 */
function Side({ path, mark }: { path: string; mark?: string }) {
  const { p, scheme } = useTheme();
  return (
    <View style={styles.side}>
      {mark === DEVICE ? (
        <Glyph name="IconThisDevice" color={p.textSub} size={16} />
      ) : mark ? (
        // In one ink, like the device glyph it stands beside.
        <ProviderMark name={mark} width={18} height={18} color={p.textSub} scheme={scheme} mono />
      ) : (
        // Keeps the two paths aligned.
        <View style={styles.sideBlank} />
      )}
      <Body>{path}</Body>
    </View>
  );
}

/** The mark for a folder on this phone. */
const DEVICE = "__device__";

function sideMark(side: string, remotes: Remote[]): string | undefined {
  if (side.indexOf(":") < 2) return side ? DEVICE : undefined;
  return markForSide(side, remotes);
}

/**
 * Returns the glyph for a job's direction, accepting the older spellings as
 * directionKey does.
 */
export function directionGlyph(direction: string | undefined): string {
  if (direction === "leftToRight" || direction === "toRight" || direction === "right") {
    return "IconToRight";
  }
  if (direction === "rightToLeft" || direction === "toLeft" || direction === "left") {
    return "IconToLeft";
  }
  return "IconBothWays";
}

export function arrow(direction: string): string {
  if (direction === "toRight" || direction === "right") return "→";
  if (direction === "toLeft" || direction === "left") return "←";
  return "↔";
}

/** Formats how long ago a timestamp was, using lib/since.ts and the translated unit. */
export function when(iso: string, t: T): string {
  const { count, unit } = since(iso);
  return `${count} ${t(unit)}`;
}

const styles = StyleSheet.create({
  menuSlot: { marginStart: "auto" },
  side: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  way: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sideBlank: { width: 18 },
  // Room at the end so the floating button does not cover the last card.
  list: { padding: space.lg, gap: space.md, paddingBottom: FAB_ROOM },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
});
