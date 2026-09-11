import { useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, type Bin } from "../api";
import { useT } from "../i18n";
import type { JobsStack } from "../nav";
import { space } from "../theme";
import { Badge, Button, Caption, Card, Empty, Mono, Page, Title, useTheme } from "../ui";
import { bytes } from "./Targets";

/**
 * What this job deleted, and getting it back.
 *
 * A deletion here was a MOVE into a hidden folder, which is what makes the
 * whole product safe to point at a photo library. This screen is the other
 * half of that promise: a bin nobody can open is a bin nobody should trust.
 *
 * Selection by tapping, restore in one go. Per-row buttons would be a row of
 * thumb-sized targets beside a path that needs the width.
 */
export function Trash() {
  const route = useRoute<RouteProp<JobsStack, "Trash">>();
  const { t } = useT();
  const { p, radius, accent } = useTheme();
  const { name: job, side } = route.params;

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

  // The engine reports the bin's TOTAL separately from what it sent, because a
  // bin with nine thousand files in it is answered with a page of them. Taking
  // the length of the page as the count is how a screen ends up saying "200 in
  // the bin" about a bin that holds rather more than that.
  const held = bin.total || items.length;
  const size = bytes(items.reduce((n, e) => n + (e.size ?? 0), 0));

  // Keyed by path AND run, because the same path can be in the bin several
  // times over from several runs, and a set of bare paths would restore the
  // wrong copy of a file somebody deleted twice.
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
          <Title>{`${t("phone.bin")} ${t(side === "left" ? "side.left" : "side.right")}`}</Title>
          <Badge label={String(held)} />
        </View>
        <Caption>{t("trash.holding", { count: held, size })}</Caption>
      </Card>

      {items.slice(0, 200).map((item) => {
        const id = `${item.runId}/${item.path}`;
        const on = chosen.has(id);
        return (
          <Pressable
            key={id}
            onPress={() => toggle(id)}
            android_ripple={{ color: p.hover }}
            style={[
              styles.row,
              {
                backgroundColor: on ? p.surface2 : p.surface,
                borderColor: on ? accent : p.border,
                borderRadius: radius.control,
              },
            ]}
          >
            <Mono>{item.path}</Mono>
            <Caption>{when(item.filed) ?? t("trash.unknownAge")}</Caption>
          </Pressable>
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
          // One at a time, because the engine restores one at a time: a file
          // coming back is a move, and a batch that failed halfway would leave
          // somebody guessing which half. The first failure stops the rest and
          // says so, which is the same rule the runs follow.
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

/** A timestamp as a date somebody reads, or nothing if there is none. */
function when(stamp: string | null): string | null {
  if (!stamp) return null;
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleString();
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.xs,
  },
});
