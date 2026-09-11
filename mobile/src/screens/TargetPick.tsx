import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, type Provider } from "../api";
import { useT } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { space, text } from "../theme";
import { Caption, Empty, Page, Title, useTheme } from "../ui";

/**
 * Which kind of storage, by NAME rather than by protocol.
 *
 * Two across, the same shape the desktop settled on, because a phone is narrow
 * and a product name has to fit on the tile rather than beside it. The list is
 * whatever the ENGINE offers - `remotes.Providers()` filters by what is
 * actually compiled in, so a provider on screen is one this build can reach.
 *
 * No brand marks here, and that is a deliberate omission rather than an
 * oversight: the fifty-five SVGs are React components built for the web, and
 * carrying them into React Native means fifty-five files re-rendered through
 * react-native-svg. The names are what somebody is looking for anyway - the
 * marks earn their place on a wide screen where a name alone leaves the tile
 * mostly empty.
 */
export function TargetPick() {
  const nav = useNavigation<Nav<TargetsStack>>();
  const { t } = useT();
  const { p, radius } = useTheme();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.storage().then(
      (s) => setProviders(s.providers),
      (e: Error) => setError(e.message),
    );
  }, []);

  if (!providers) return <Empty title={t("history.working")} detail={error || undefined} />;

  const clouds = providers.filter((x) => x.group !== "protocol");
  const protocols = providers.filter((x) => x.group === "protocol");

  const tile = (provider: Provider) => (
    <Pressable
      key={provider.id}
      onPress={() => nav.navigate("TargetEdit", { provider: provider.id })}
      android_ripple={{ color: p.hover }}
      style={[
        styles.tile,
        { backgroundColor: p.surface2, borderColor: p.border, borderRadius: radius.card },
      ]}
    >
      <Text style={[styles.name, { color: p.text }]}>{provider.name}</Text>
      {provider.hint ? (
        <Text numberOfLines={2} style={[styles.hint, { color: p.textMuted }]}>
          {provider.hint}
        </Text>
      ) : null}
    </Pressable>
  );

  return (
    <Page>
      <Title>{t("targets.cloud")}</Title>
      <View style={styles.grid}>{clouds.map(tile)}</View>
      <Title>{t("targets.connections")}</Title>
      <View style={styles.grid}>{protocols.map(tile)}</View>
      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: {
    // Two across with the page's own gap between them, which is what `48%`
    // buys without having to measure the window.
    width: "48%",
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    justifyContent: "center",
    gap: 2,
  },
  name: { fontSize: text.body, fontWeight: "600" },
  hint: { fontSize: text.caption },
});
