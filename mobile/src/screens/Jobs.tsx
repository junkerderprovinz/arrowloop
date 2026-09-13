import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api, type Job, type Remote } from "../api";
import { CardMenu } from "../CardMenu";
import { Glyph, ProviderMark } from "../glyphs";
import { directionKey, markForSide } from "../jobMark";
import { jobCopy } from "../../../web/src/lib/jobCopy.data";
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
  /** The targets behind the sides, for a card's logo. A card that cannot name
   *  its target simply shows none. */
  const [remotes, setRemotes] = useState<Remote[]>([]);
  useEffect(() => {
    // Refetched on focus, not once: a target created on the next tab has to
    // reach this list, and a card whose logo appears only after a restart is
    // the kind of thing somebody reports as "the logo is missing".
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
   * A copy of a job, beside the original, and immediately visible.
   *
   * No confirmation: this one is undone by deleting the copy, and a dialog in
   * front of a reversible act only teaches people to click through dialogs.
   */
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
        // Not "destructive": GlimStone 1.12.0 paints no delete red, and
        // the platform dialog is no exception to a rule about deletes.
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
          // Opening and editing are one screen now, so both verbs land in the
          // same place. They stay as two menu rows because they are two
          // INTENTIONS, and somebody looking for "bearbeiten" should find it.
          onEdit={() => nav.navigate("JobEdit", { name: item.name })}
          onDuplicate={() => duplicate(item)}
          onRemove={() => remove(item)}
          // EITHER side, right first because that is the usual shape. A job
          // that pulls from a cloud into a folder on the phone carries its
          // target on the left, and only asking the right drew nothing for it.
          // A job between two local folders still has no logo, which is
          // correct: there is no cloud in it to show.
          mark={markForSide(item.right, remotes) ?? markForSide(item.left, remotes)}
          leftMark={sideMark(item.left, remotes)}
          rightMark={sideMark(item.right, remotes)}
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
  /** The target's logo, or nothing when it cannot be named without guessing. */
  mark?: string;
  /** What goes in front of each side: a provider's mark, the phone glyph, or
   *  nothing. See sideMark. */
  leftMark?: string;
  rightMark?: string;
}) {
  const { t } = useT();
  const hue = useHue(index);
  const { p, scheme } = useTheme();
  return (
    <Card onPress={onOpen} hue={hue}>
      {/* The same head the target list draws, from the same component - see
          CardHead in ui.tsx. The logo comes from the engine, which resolves the
          product from the settings the target was created with. */}
      <CardHead mark={mark} title={job.name}>
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
              // Three bare verbs. jdp: "im hamburger menue auf der auftrag card
              // soll einfach nur oeffnen, bearbeiten und loeschen stehen." The
              // card they sit on is already the subject, so repeating it in
              // every row says the same word three times and makes the three
              // acts harder to tell apart, not easier.
              //
              // Opening leads, because the card's own tap does the same thing
              // and reachable is not the same as findable.
              { label: t("action.open"), glyph: "IconPreview", onPress: onOpen },
              { label: t("action.edit"), glyph: "IconEdit", onPress: onEdit },
              // jdp: "auftraege soll man via hamburgermenue auch duplizieren
              // koennen." The copy arrives HELD and pointing at the same two
              // folders as its original - see jobCopy.data.ts for why that is
              // the only safe state for it to arrive in.
              { label: t("edit.duplicate"), glyph: "IconCopy", onPress: onDuplicate },
              { label: t("action.delete"), glyph: "IconDelete", onPress: onRemove },
            ]}
          />
        </View>
      </CardHead>

      {/* The two paths with the direction between them, one per line and each
          allowed to wrap. Truncating a path in the middle is what a table
          does, and it hides exactly the part that distinguishes two similar
          jobs.

          EACH SIDE SAYS WHAT IT IS FIRST. jdp: "vor dem Pfad der Cloud soll das
          cloudlogo als glyph sein und vor dem Geraetepfad ein Handy glyph."
          Two stacked paths left the reader to work that out by reading them,
          which is fine for /storage/emulated/0/DCIM and useless for two targets
          whose names are both somebody's own. */}
      <Side path={job.left} mark={leftMark} />
      {/* The arrow AND the words, unmoved. The arrow keeps the position it had
          between the two paths, where it reads as the relationship between
          them; the words are what somebody needs the first time.

          A REAL GLYPH now, not a character from whatever font the phone ships.
          jdp: "der pfeil fuer die synchronisationsrichtung soll auch ein
          groesserer glyph sein." The three direction glyphs have existed since
          the desktop rail was built; this card was drawing a text arrow beside
          marks from a 14-unit grid, which made it the one symbol here that came
          from somewhere else. */}
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

      {/* Two verbs, never one button, which is the desktop's own rule for this
          pair: a job held on its schedule can still be STARTED by hand, and
          that is the whole point of holding one rather than deleting it.

          `jobs.cancelRun` rather than `jobs.pause` for the running button.
          Pausing is what the OTHER one does - it holds the schedule - and one
          card able to print the same word for two different acts is how
          somebody stops a run when they meant to stop a job. And ABBRECHEN
          rather than anhalten, because that is what happens: the run's context
          is cancelled and the next one starts from the beginning. jdp: "lauf
          anhalten soll den lauf abbrechen und auch so heissen."

          RUNNING ON THE RIGHT, holding on the left, per GlimStone 1.14.0: the
          control that goes ahead sits on the right. jdp: "jetzt ausfuehren soll
          rechts sein und pausieren links." It was the other way round because
          running is the commoner act and commoner felt like first - which is
          exactly the local reasoning that rule exists to overrule. */}
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
 * One side of a job: what it is, then where.
 *
 * The mark is the provider's own where the side names a target, and the phone
 * glyph where it is a path on this device. A side that is neither - a path on
 * some other machine, a target whose product cannot be named without guessing -
 * gets no mark and keeps the plain line it always had. An unknown side drawn
 * with a borrowed symbol would be worse than an unmarked one.
 */
function Side({ path, mark }: { path: string; mark?: string }) {
  const { p, scheme } = useTheme();
  return (
    <View style={styles.side}>
      {mark === DEVICE ? (
        <Glyph name="IconThisDevice" color={p.textSub} size={16} />
      ) : mark ? (
        // ONE INK. In front of a path the mark is a symbol saying "this side is
        // that service", which is the job the device glyph does on the other
        // line - and that one is drawn in the text colour. jdp: "das cloud logo
        // vor dem Pfad farblos ... und als glyph dienen."
        <ProviderMark name={mark} width={18} height={18} color={p.textSub} scheme={scheme} mono />
      ) : (
        // An empty slot rather than no slot, so the two paths stay aligned with
        // each other whether or not both sides could be named.
        <View style={styles.sideBlank} />
      )}
      <Body>{path}</Body>
    </View>
  );
}

/** Not a provider: the marker for "this is a folder on this phone". */
const DEVICE = "__device__";

/**
 * What to draw in front of a side.
 *
 * A side with no colon is a path on this device. Anything else is a target, and
 * the engine says which product it is.
 */
function sideMark(side: string, remotes: Remote[]): string | undefined {
  if (side.indexOf(":") < 2) return side ? DEVICE : undefined;
  return markForSide(side, remotes);
}

/**
 * The direction as one of the app's own three marks.
 *
 * The engine's spellings and the older ones beside them, exactly as
 * directionKey does it: a configuration written by an earlier build carries
 * `toRight`, and falling through to the two-way mark for it would draw a
 * one-way job as two-way.
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
  menuSlot: { marginStart: "auto" },
  // A side: its mark, then its path, the path free to wrap under itself.
  side: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  // The direction sits in the same column the two marks do, so the three
  // symbols line up down the left edge of the card.
  way: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sideBlank: { width: 18 },
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
