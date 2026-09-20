import { useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type Entry } from "../api";
import { useT } from "../i18n";
import type { HistoryStack } from "../nav";
import { space } from "../theme";
import { Badge, Caption, Card, Empty, Mono, Page, Title } from "../ui";
import { entryKey } from "./History";

/**
 * What one run did, path by path. The entries are fetched only when a run is
 * opened, since the history list needs nothing but the summaries.
 */
export function RunDetail() {
  const route = useRoute<RouteProp<HistoryStack, "RunDetail">>();
  const { t } = useT();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.runEntries(route.params.id).then(setEntries, (e: Error) => setError(e.message));
  }, [route.params.id]);

  if (error) return <Empty title={t("error.unreachable")} detail={error} />;
  if (!entries) return <Empty title={t("history.working")} />;
  if (entries.length === 0) {
    return <Empty title={t("phone.runEmpty")} />;
  }

  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.Kind) ?? [];
    list.push(entry);
    groups.set(entry.Kind, list);
  }

  return (
    <Page>
      <Title>{route.params.job}</Title>
      {[...groups.entries()].map(([kind, list]) => (
        <Card key={kind}>
          <View style={styles.head}>
            <Title>{t(entryKey(kind))}</Title>
            <Badge label={String(list.length)} />
          </View>
          {list.slice(0, 50).map((entry, i) => (
            <Mono key={`${entry.Path}-${i}`}>{entry.Path}</Mono>
          ))}
          {list.length > 50 ? <Caption>{t("trash.more", { total: list.length, shown: 50 })}</Caption> : null}
        </Card>
      ))}
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
