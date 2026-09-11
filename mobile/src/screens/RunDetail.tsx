import { useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type Entry } from "../api";
import { useT } from "../i18n";
import type { HistoryStack } from "../nav";
import { space } from "../theme";
import { Badge, Caption, Card, Empty, Mono, Page, Title } from "../ui";

/**
 * What ONE run did, path by path.
 *
 * A separate request rather than a field on every run in the list, and that is
 * the engine's own design: a page showing fifty runs wants fifty summaries,
 * and fetching every path each of them touched to draw a row saying "12
 * copied" would be thousands of strings nobody reads. The detail is fetched
 * when a run is opened, which is the moment somebody has asked for it.
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

  // Grouped by what was done, because "what changed" is the question and a
  // hundred rows in file order answers it only after a hundred rows.
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

function entryKey(
  kind: string,
): "entry.copy" | "entry.move" | "entry.trash" | "entry.conflict" | "entry.mkdir" | "entry.rmdir" | "entry.skip" | "entry.other" {
  switch (kind) {
    case "copy":
      return "entry.copy";
    case "move":
      return "entry.move";
    case "trash":
    case "delete":
      return "entry.trash";
    case "conflict":
      return "entry.conflict";
    case "mkdir":
      return "entry.mkdir";
    case "rmdir":
      return "entry.rmdir";
    case "skip":
      return "entry.skip";
    default:
      return "entry.other";
  }
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
});
