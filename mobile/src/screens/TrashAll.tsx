import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api, type Job, type TrashItem, type TrashSide } from "../api";
import { dated } from "../clock";
import { useT } from "../i18n";
import { jobSides } from "../sides";
import { bytes } from "../space";
import { space } from "../theme";
import { useEngineStream } from "../useEngine";
import { failureLine } from "../../../web/src/lib/failure";
import { byJob, trashTotals } from "../../../web/src/lib/trashView";
import { JobChips } from "../jobChips";
import { ListHead } from "../listHead";
import { Tiles } from "../tiles";
import { Body, Button, Caption, Card, Empty, Fab, Floating, Mono, Page, PickRow, Sheet, Title } from "../ui";

/** Names one trashed file across every job and side. */
function itemKey(bin: TrashSide, item: TrashItem): string {
  return `${bin.job}\n${bin.side}\n${item.runId}/${item.path}`;
}

/**
 * Every job's trash on both sides, under a chip per side that shows that side
 * alone and a head whose filter picks the job. Rows are tapped to choose them,
 * as on a job's own trash screen; putting back is one tap, removing for good
 * asks. Emptying what the screen shows is its floating button, as on the web's
 * page.
 */
export function TrashAll() {
  const { t, lang } = useT();
  const [bins, setBins] = useState<TrashSide[] | null>(null);
  // For the name of each side, which a bin only knows as left or right.
  const [jobs, setJobs] = useState<Job[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<"left" | "right" | null>(null);
  const [job, setJob] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [trash, known] = await Promise.all([api.trashAll(), api.jobs()]);
      setBins(trash.sides);
      setJobs(known);
      setChosen(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEngineStream(true, (event) => {
    if (event.phase === "finished") void load();
  });

  // One request after another; the first refusal stops the rest.
  const run = async (work: (() => Promise<unknown>)[]) => {
    setBusy(true);
    setError("");
    try {
      for (const w of work) await w();
    } catch (e) {
      setError((e as Error).message);
    }
    await load();
    setBusy(false);
  };

  const ask = (title: string, message: string, confirm: string, go: () => void) =>
    Alert.alert(title, message, [
      { text: t("confirm.cancel"), style: "cancel" },
      { text: confirm, onPress: go },
    ]);

  if (!bins) return <Empty title={t("history.working")} detail={error || undefined} />;

  const names = byJob(bins.filter((b) => !b.error && b.total > 0)).map((g) => g.job);
  const shownJob = names.includes(job) ? job : "";
  const ofJob = bins.filter((b) => !shownJob || b.job === shownJob);
  const shown = ofJob.filter((b) => !side || b.side === side);
  const readable = shown.filter((b) => !b.error);
  const count = (which: "left" | "right") =>
    trashTotals(ofJob.filter((b) => !b.error && b.side === which)).entries;
  const totals = trashTotals(readable);
  const picked = readable.flatMap((b) => b.entries.filter((e) => chosen.has(itemKey(b, e))).map((e) => ({ bin: b, item: e })));

  if (names.length === 0 && bins.every((b) => !b.error)) return <Empty title={t("trash.nothing")} />;

  return (
    <Floating>
      <Page fab>
        <Tiles
          label={t("nav.trash")}
          tiles={[
            { id: "left" as const, label: t("edit.left"), count: count("left") },
            { id: "right" as const, label: t("edit.right"), count: count("right") },
          ]}
          picked={side}
          onPick={(which) => setSide((old) => (old === which ? null : which))}
        />
        <Caption>{t("trash.holding", { count: totals.entries, size: bytes(totals.bytes) })}</Caption>
        {/* The job chips need two jobs to choose between. */}
        {names.length > 1 ? (
          <ListHead
            page="trash"
            heads={[{ id: "job", label: t("history.filterJob"), filter: { active: shownJob !== "", open: () => setFiltering(true) } }]}
          />
        ) : null}

        {shown
          .filter((b) => b.total > 0 || b.error)
          .map((bin) => {
            const place = jobSides(jobs, bin.job, t)[bin.side === "left" ? 0 : 1];
            return (
            <Card key={`${bin.job}/${bin.side}`}>
              <Title>{`${bin.job} · ${place}`}</Title>
              {bin.error ? (
                <Caption>{t("trash.unread", { error: failureLine(bin.error, bin.failure, t, lang) })}</Caption>
              ) : (
                <>
                  <Caption>{t("trash.holding", { count: bin.total, size: bytes(bin.bytes) })}</Caption>
                  {bin.entries.slice(0, 200).map((item) => {
                    const key = itemKey(bin, item);
                    const on = chosen.has(key);
                    return (
                      <PickRow
                        key={key}
                        on={on}
                        label={item.path}
                        // A file somebody put there by hand has no run, and only
                        // emptying reaches it.
                        disabled={!item.runId}
                        onPress={() =>
                          setChosen((old) => {
                            const next = new Set(old);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                      >
                        <Mono>{item.path}</Mono>
                        <Caption>{`${bytes(item.size)} · ${item.filed ? dated(item.filed, lang) : t("trash.unknownAge")}`}</Caption>
                      </PickRow>
                    );
                  })}
                  {bin.entries.length > 200 ? (
                    <Caption>{t("trash.more", { total: bin.total, shown: 200 })}</Caption>
                  ) : null}
                  <View style={styles.actions}>
                    <Button
                      label={t("trash.emptySide")}
                      labelKey="trash.emptySide"
                      disabled={busy}
                      onPress={() =>
                        ask(
                          t("trash.emptyAll"),
                          t("trash.emptySideConfirm", {
                            job: bin.job,
                            side: place,
                            count: bin.total,
                            size: bytes(bin.bytes),
                          }),
                          t("trash.emptyAll"),
                          () => void run([() => api.emptyTrash(bin.job, bin.side, bin.mark)]),
                        )
                      }
                    />
                  </View>
                </>
              )}
            </Card>
            );
          })}

        {error ? <Body>{error}</Body> : null}

        <View style={styles.actions}>
          <Button
            label={t("trash.delete")}
            labelKey="trash.delete"
            disabled={busy || picked.length === 0}
            onPress={() =>
              ask(
                t("trash.delete"),
                picked.length === 1 && picked[0]
                  ? t("trash.deleteConfirm", { path: picked[0].item.path })
                  : t("trash.deleteManyConfirm", { count: picked.length }),
                t("confirm.delete"),
                () => void run(picked.map(({ bin, item }) => () => api.deleteTrash(bin.job, bin.side, item.path, item.runId))),
              )
            }
          />
          <Button
            label={t("trash.restore")}
            labelKey="trash.restore"
            busy={busy}
            disabled={picked.length === 0}
            onPress={() => void run(picked.map(({ bin, item }) => () => api.restoreTrash(bin.job, bin.side, item.path, item.runId)))}
          />
        </View>
      </Page>
      <Sheet open={filtering} title={t("history.filter")} onClose={() => setFiltering(false)}>
        <JobChips names={names} job={shownJob} onJob={setJob} />
      </Sheet>
      {totals.entries > 0 && !busy ? (
        <Fab
          label={t("trash.emptyAll")}
          labelKey="trash.emptyAll"
          onPress={() =>
            ask(
              t("trash.emptyAll"),
              t("trash.emptyAllConfirm", { count: totals.entries, size: bytes(totals.bytes) }),
              t("trash.emptyAll"),
              () => void run(readable.filter((b) => b.total > 0).map((b) => () => api.emptyTrash(b.job, b.side, b.mark))),
            )
          }
        />
      ) : null}
    </Floating>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: space.sm,
  },
});
