import { useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type Bin } from "../api";
import { dated } from "../clock";
import { useT } from "../i18n";
import type { JobsStack } from "../nav";
import { space } from "../theme";
import { Badge, Button, Caption, Card, Empty, Mono, Page, PickRow, Title } from "../ui";
import { bytes } from "../space";

/**
 * Lists what a job moved into its bin and restores the rows tapped. Per-row
 * buttons would take the width a path needs.
 */
export function Trash() {
  const route = useRoute<RouteProp<JobsStack, "Trash">>();
  const { t, lang } = useT();
  const { name: job, side, place } = route.params;

  const [bin, setBin] = useState<Bin | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBin(await api.trash(job, side));
      setChosen(new Set());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [job, side]);

  useEffect(() => {
    load();
  }, [load]);

  if (!bin) return <Empty title={t("history.working")} detail={error || undefined} />;
  const items = bin.entries ?? [];
  if (items.length === 0) return <Empty title={t("trash.empty")} detail={bin.dir} />;

  // A large bin is answered with one page, so the count comes from `total`.
  const held = bin.total || items.length;
  const size = bytes(items.reduce((n, e) => n + (e.size ?? 0), 0));

  // Keyed by run and path, since one path can be in the bin once per run.
  const toggle = (id: string) =>
    setChosen((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Page>
      <Card>
        <View style={styles.head}>
          <Title>{`${t("nav.trash")} · ${place}`}</Title>
          <Badge label={String(held)} />
        </View>
        <Caption>{t("trash.holding", { count: held, size })}</Caption>
      </Card>

      {items.slice(0, 200).map((item) => {
        const id = `${item.runId}/${item.path}`;
        const on = chosen.has(id);
        return (
          <PickRow key={id} on={on} label={item.path} onPress={() => toggle(id)}>
            <Mono>{item.path}</Mono>
            <Caption>{item.filed ? dated(item.filed, lang) : t("trash.unknownAge")}</Caption>
          </PickRow>
        );
      })}
      {items.length > 200 ? <Caption>{t("trash.more", { total: held, shown: 200 })}</Caption> : null}

      {error ? <Caption>{error}</Caption> : null}

      <Button
        label={t("trash.restore")}
        labelKey="trash.restore"
        tone="accent"
        busy={busy}
        disabled={chosen.size === 0}
        onPress={async () => {
          setBusy(true);
          // The engine restores one file per request, and the first failure
          // stops the rest.
          try {
            for (const item of items) {
              if (!chosen.has(`${item.runId}/${item.path}`)) continue;
              await api.restoreTrash(job, side, item.path, item.runId);
            }
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
});
