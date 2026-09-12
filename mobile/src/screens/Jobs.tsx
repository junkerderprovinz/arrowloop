import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api, type Job, type Provider, type Remote } from "../api";
import { CardMenu } from "../CardMenu";
import { ProviderMark } from "../glyphs";
import { directionKey, markForSide } from "../jobMark";
import { useT, type T } from "../i18n";
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
  Empty,
  Fab,
  FAB_ROOM,
  Floating,
  Title,
  useHue,
  useTheme,
} from "../ui";

/**
 * The jobs, and what each of them is doing right now.
 *
 * The screen somebody opens the app FOR. On a desktop this is a table with
 * eight columns; here it is one card per job, because a table on a phone is a
 * table you scroll sideways and then cannot read.
 *
 * What is on the card: is it running, which way it syncs, when it last
 * succeeded, and the two paths. What is behind a tap: everything else. That
 * split is the design - a list answers "is it keeping up", and a detail answers
 * "what exactly does this do".
 */
export function Jobs() {
  const nav = useNavigation<Nav<JobsStack>>();
  const { t } = useT();
  const { p, accent } = useTheme();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  /** The targets and the products behind them, for a card's logo. Fetched
   *  once: neither changes while somebody is looking at a list of jobs, and a
   *  card that could not name its target simply shows none. */
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  useEffect(() => {
    api.storage().then(
      (list) => {
        setRemotes(list.remotes);
        setProviders(list.providers);
      },
      () => {},
    );
  }, []);

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

  // The engine says when something changed, so the list is not on a timer. A
  // run that finishes is visible the moment it finishes.
  useEngineEvents(true, load);

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
   * Hold a job, or let it go again.
   *
   * Read-modify-write of the whole configuration, because that is the only
   * shape the engine offers and the same one the editor uses to save. The read
   * happens HERE rather than from the list on screen: `api.jobs()` returns live
   * state - what is running, when it last succeeded - and writing that back as
   * configuration would persist a snapshot of the moment as settings.
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

  /**
   * Deleting from the list, with the question asked first.
   *
   * It lived only inside the editor, so getting rid of a job meant opening it
   * and scrolling past everything it does. The confirmation is not a formality:
   * this is the one act on the card that cannot be undone from here.
   */
  const remove = (job: Job) => {
    Alert.alert(t("edit.removeJob"), t("edit.removeStakes", { name: job.name }), [
      { text: t("confirm.cancel"), style: "cancel" },
      {
        text: t("confirm.delete"),
        style: "destructive",
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
      // NOTHING where there is nothing, and that is not a bare blank: the
      // "Add job" button sits directly above this, so the empty list already
      // says what it is and what to do about it. A sentence under a button that
      // makes the same offer is the offer twice, and on a phone it costs the
      // first screenful. jdp: "in der Aufträge und ziele seite soll der hinweis
      // text weg wenn noch kein auftrag oder ziel vorhanden ist."
      //
      // The LOADING and FAILED states above keep their own words, and that is
      // the distinction worth holding: an empty list with a button is a state
      // somebody can act on, while a list that is still arriving or could not
      // be fetched is not - and those two really are indistinguishable from a
      // blank screen.
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
          onEdit={() => nav.navigate("JobEdit", { name: item.name })}
          onRemove={() => remove(item)}
          // The RIGHT side, because that is the one that names a target. A job
          // between two local folders has no logo, which is correct: there is
          // no cloud in it to show.
          mark={markForSide(item.right, remotes, providers)}
        />
      )}
      />
      {/* The add button floats over the list instead of standing at the top of
          it. jdp: "die button auftraege und speicher hinzufuegen soll ein
          schwebender button rechts unten sein." */}
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
  onRemove,
  mark,
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
  onRemove: () => void;
  /** The target's logo, or nothing when it cannot be named without guessing. */
  mark?: string;
}) {
  const { t } = useT();
  const hue = useHue(index);
  const { p, scheme } = useTheme();
  return (
    <Card onPress={onOpen} hue={hue}>
      <View style={styles.head}>
        {/* The target's logo, when the target can be named without guessing.
            See jobMark.ts: a backend claimed by more than one marked provider
            gets none, because a mark naming the WRONG service is worse than no
            mark - which is this house's standing rule for brands. */}
        {mark ? (
          <View style={styles.cardMark}>
            <ProviderMark name={mark} width={24} height={24} color={p.textSub} scheme={scheme} />
          </View>
        ) : null}
        <Title>{job.name}</Title>
        {job.disabled ? (
          <Badge label={t("jobs.state.disabled")} />
        ) : job.running ? (
          <Badge label={t("jobs.state.running")} tone="accent" />
        ) : job.watch ? (
          <Badge label={t("jobs.cadence.live")} tone="ok" />
        ) : null}
        {/* Pushed hard right, and the two rare acts live in it. */}
        <View style={styles.menuSlot}>
          <CardMenu
            items={[
              { label: t("edit.editJob"), glyph: "IconEdit", onPress: onEdit },
              { label: t("edit.removeJob"), glyph: "IconDelete", danger: true, onPress: onRemove },
            ]}
          />
        </View>
      </View>

      {/* The two paths with the direction between them, one per line and each
          allowed to wrap. Truncating a path in the middle is what a table
          does, and it hides exactly the part that distinguishes two similar
          jobs. */}
      <Body>{job.left}</Body>
      {/* The arrow AND the words. The arrow keeps the position it had between
          the two paths, where it reads as the relationship between them; the
          words are what somebody needs the first time. */}
      <Caption>{`${arrow(job.direction)}  ${t(directionKey(job.direction))}`}</Caption>
      <Body>{job.right}</Body>

      <Caption>
        {job.lastSuccess
          ? `${t("jobs.lastRun", { when: when(job.lastSuccess, t) })} ${t("jobs.ago")}`
          : t("jobs.activityEmpty")}
      </Caption>

      {/* Two verbs, never one button, which is the desktop's own rule for this
          pair: a job held on its schedule can still be STARTED by hand, and
          that is the whole point of holding one rather than deleting it.

          `jobs.stopRun` rather than `jobs.pause` for the left button. Pausing
          is what the right one does - it holds the schedule - and one card able
          to print the same word for two different acts is how somebody stops a
          run when they meant to stop a job. */}
      <View style={styles.actions}>
        <Button
          label={job.running ? t("jobs.stopRun") : t("jobs.runNow")}
          labelKey={job.running ? "jobs.stopRun" : "jobs.runNow"}
          tone={job.running ? "neutral" : "accent"}
          busy={busy}
          onPress={onAct}
        />
        <Button
          label={job.disabled ? t("jobs.resume") : t("jobs.pause")}
          labelKey={job.disabled ? "jobs.resume" : "jobs.pause"}
          busy={holding}
          onPress={onHold}
        />
      </View>
    </Card>
  );
}

/** The direction as an arrow, which is read faster than the word. */
export function arrow(direction: string): string {
  if (direction === "toRight" || direction === "right") return "→";
  if (direction === "toLeft" || direction === "left") return "←";
  return "↔";
}

/**
 * A timestamp as somebody would say it out loud, in the reader's own language.
 *
 * This used to be a second implementation that returned `"just now"`, `"3 h"`
 * and `"2 d"` as English literals, which the card then wrapped in translated
 * text: a German screen read "zuletzt just now her", which is neither a
 * language nor a sentence. Measured on the device.
 *
 * The rule is the desktop's, from `lib/since.ts`, and it returns the unit as a
 * translation KEY rather than a word - which is the only shape that can be said
 * in forty-two languages.
 */
export function when(iso: string, t: T): string {
  const { count, unit } = since(iso);
  return `${count} ${t(unit)}`;
}

const styles = StyleSheet.create({
  // The logo before the name, the menu hard right, and the badge between them
  // taking whatever is left.
  cardMark: { width: 26, alignItems: "center" },
  menuSlot: { marginStart: "auto" },
  // The extra room at the end is for the floating button, which would
  // otherwise cover the last card - the one somebody scrolled to reach.
  list: { padding: space.lg, gap: space.md, paddingBottom: FAB_ROOM },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
});
