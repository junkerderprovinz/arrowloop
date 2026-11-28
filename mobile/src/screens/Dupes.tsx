import { useRoute, type RouteProp } from "@react-navigation/native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, type Duplicates } from "../api";
import { useT } from "../i18n";
import type { JobsStack } from "../nav";
import { space, text } from "../theme";
import { Badge, Body, Button, Caption, Card, Mono, Page, useTheme } from "../ui";
import { bytes } from "../usage";

/**
 * Lists content found in more than one place on one side of a job, as the
 * container's card does. It reports and never deletes, since which copy to
 * keep depends on what the folders mean, and it searches only when asked,
 * since it hashes much of the tree.
 */
export function Dupes() {
  const route = useRoute<RouteProp<JobsStack, "Dupes">>();
  const { t } = useT();
  const { p } = useTheme();
  const { name: job, places } = route.params;

  const [side, setSide] = useState<"left" | "right">("left");
  const [found, setFound] = useState<Duplicates | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const look = async (which: "left" | "right") => {
    setSide(which);
    setBusy(true);
    setError("");
    setFound(null);
    try {
      setFound(await api.duplicates(job, which));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page spread>
      {/* One under the other, since a side's name needs the full width. */}
      <View style={styles.stack}>
        {(["left", "right"] as const).map((which, i) => (
          <Button
            key={which}
            label={`${t("jobs.dupes")} · ${places[i]}`}
            glyph="IconSearch"
            busy={busy && side === which}
            disabled={busy}
            onPress={() => void look(which)}
          />
        ))}
      </View>

      {error ? <Caption>{error}</Caption> : null}

      {found && found.groups.length === 0 ? <Body>{t("dupes.none", { scanned: found.scanned })}</Body> : null}

      {found && found.groups.length > 0 ? (
        <>
          <Caption>
            {t("dupes.summary", { sets: found.groups.length, wasted: bytes(found.wasted), scanned: found.scanned })}
          </Caption>
          {/* Without this, a target that cannot hash would read as nothing more to find. */}
          {found.unhashable > 0 ? (
            <Text style={[styles.warn, { color: p.warnInk }]}>
              {t("dupes.unhashable", { count: found.unhashable })}
            </Text>
          ) : null}
          {found.groups.map((group) => (
            <Card key={group.hash}>
              <View style={styles.head}>
                <Badge label={`${group.paths.length}×`} tone="warn" />
                <Caption>{t("dupes.each", { size: bytes(group.size), wasted: bytes(group.wasted) })}</Caption>
              </View>
              {group.paths.map((path) => (
                <Mono key={path}>{path}</Mono>
              ))}
            </Card>
          ))}
        </>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  warn: { fontSize: text.subline, lineHeight: 18 },
});
