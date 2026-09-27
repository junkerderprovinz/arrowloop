import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { api, type TrashItem, type TrashSide } from "../api";
import { useT } from "../i18n";
import { bytes } from "../space";
import { space } from "../theme";
import { useEngineStream } from "../useEngine";
import { trashTotals } from "../../../web/src/lib/trashView";
import { Body, Button, Caption, Card, Empty, Mono, Page, Title, useTheme } from "../ui";

/** Names one trashed file across every job and side. */
function itemKey(bin: TrashSide, item: TrashItem): string {
  return `${bin.job}\n${bin.side}\n${item.runId}/${item.path}`;
}

/**
 * Every job's trash on both sides. Rows are tapped to choose them, as on a
 * job's own trash screen; putting back is one tap, removing for good asks.
 */
export function TrashAll() {
  const { t } = useT();
  const { p, corners, accent } = useTheme();
  const [bins, setBins] = useState<TrashSide[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setBins((await api.trashAll()).sides);
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

  const readable = bins.filter((b) => !b.error);
  const totals = trashTotals(readable);
  const picked = readable.flatMap((b) => b.entries.filter((e) => chosen.has(itemKey(b, e))).map((e) => ({ bin: b, item: e })));

  if (totals.entries === 0 && bins.every((b) => !b.error)) return <Empty title={t("trash.nothing")} />;

  return (
    <Page>
      <Card>
        <Title>{t("nav.trash")}</Title>
        <Caption>{t("trash.holding", { count: totals.entries, size: bytes(totals.bytes) })}</Caption>
      </Card>

      {bins
        .filter((b) => b.total > 0 || b.error)
        .map((bin) => (
          <Card key={`${bin.job}/${bin.side}`}>
            <Title>{`${bin.job} · ${t(bin.side === "left" ? "edit.left" : "edit.right")}`}</Title>
            {bin.error ? (
              <Caption>{t("trash.unread", { error: bin.error })}</Caption>
            ) : (
              <>
                <Caption>{t("trash.holding", { count: bin.total, size: bytes(bin.bytes) })}</Caption>
                {bin.entries.slice(0, 200).map((item) => {
                  const key = itemKey(bin, item);
                  const on = chosen.has(key);
                  return (
                    <Pressable
                      key={key}
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
                      android_ripple={{ color: p.hover }}
                      style={[
                        styles.row,
                        {
                          backgroundColor: on ? p.surface2 : p.surface,
                          borderColor: on ? accent : p.border,
                          ...corners.control,
                        },
                      ]}
                    >
                      <Mono>{item.path}</Mono>
                      <Caption>{`${bytes(item.size)} · ${when(item.filed) ?? t("trash.unknownAge")}`}</Caption>
                    </Pressable>
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
                          side: t(bin.side === "left" ? "side.left" : "side.right"),
                          count: bin.total,
                          size: bytes(bin.bytes),
                        }),
                        t("trash.emptyAll"),
                        () => void run([() => api.emptyTrash(bin.job, bin.side)]),
                      )
                    }
                  />
                </View>
              </>
            )}
          </Card>
        ))}

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
          tone="accent"
          busy={busy}
          disabled={picked.length === 0}
          onPress={() => void run(picked.map(({ bin, item }) => () => api.restoreTrash(bin.job, bin.side, item.path, item.runId)))}
        />
      </View>

      <Button
        label={t("trash.emptyAll")}
        labelKey="trash.emptyAll"
        wide
        disabled={busy || totals.entries === 0}
        onPress={() =>
          ask(
            t("trash.emptyAll"),
            t("trash.emptyAllConfirm", { count: totals.entries, size: bytes(totals.bytes) }),
            t("trash.emptyAll"),
            () => void run(readable.filter((b) => b.total > 0).map((b) => () => api.emptyTrash(b.job, b.side))),
          )
        }
      />
    </Page>
  );
}

function when(stamp: string | null): string | null {
  if (!stamp) return null;
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleString();
}

const styles = StyleSheet.create({
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.xs,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: space.sm,
  },
});
