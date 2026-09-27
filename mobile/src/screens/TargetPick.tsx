import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type Provider } from "../api";
import { useT } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { providerHint, providerName } from "../../../web/src/lib/optionHint";
import { space } from "../theme";
import { brandTile, ProviderMark } from "../glyphs";
import { Caption, Empty, Page, README_W, ReadmeButton, Title, useTheme } from "../ui";

/**
 * Picks the kind of storage for a new target, as README buttons matching the
 * web app's. The engine lists only the providers compiled into this build.
 * Only protocols carry a hint, since "SMB" or "WebDAV" does not say what it is.
 */
export function TargetPick() {
  const nav = useNavigation<Nav<TargetsStack>>();
  const { t } = useT();
  const { p, scheme, accent, accentContrast } = useTheme();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState("");
  const [room, setRoom] = useState(0);

  useEffect(() => {
    api.storage().then(
      (s) => setProviders(s.providers),
      (e: Error) => setError(e.message),
    );
  }, []);

  if (!providers) return <Empty title={t("history.working")} detail={error || undefined} />;

  const clouds = providers.filter((x) => x.group === "cloud");
  const storage = providers.filter((x) => x.group === "storage");
  const protocols = providers.filter((x) => x.group === "protocol");

  // As many across as fit at the README's width, sharing the row between them,
  // so a narrow phone shows one per row and a wide one several.
  const across = Math.max(1, Math.floor((room + GAP) / (README_W + GAP)));
  const width = room ? Math.floor((room - GAP * (across - 1)) / across) : README_W;

  const button = (provider: Provider) => {
    // A protocol wears one of the app's own glyphs and lights in the accent.
    const tile = brandTile(provider.mark) ?? { color: accent, ink: accentContrast };
    return (
      <ReadmeButton
        key={provider.id}
        label={providerName(provider, t)}
        tile={tile}
        width={width}
        hint={provider.group === "protocol" ? providerHint(provider.id, t) : undefined}
        mark={(lit, ink) => (
          <ProviderMark
            name={provider.mark}
            width={MARK_W}
            height={MARK_H}
            color={lit ? ink : p.textSub}
            scheme={scheme}
            lit={lit ? { ink, cut: tile.color } : undefined}
          />
        )}
        onPress={() => nav.navigate("TargetEdit", { provider: provider.id })}
      />
    );
  };

  return (
    <Page>
      <View style={styles.sections} onLayout={(e) => setRoom(e.nativeEvent.layout.width)}>
        <Title>{t("targets.cloud")}</Title>
        <View style={styles.grid}>{clouds.map(button)}</View>
        <Title>{t("targets.storage")}</Title>
        <View style={styles.grid}>{storage.map(button)}</View>
        <Title>{t("targets.connections")}</Title>
        <View style={styles.grid}>{protocols.map(button)}</View>
      </View>
      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

// The README's mark box and the gap between its buttons.
const MARK_W = 32;
const MARK_H = 25;
const GAP = 13;

const styles = StyleSheet.create({
  sections: { gap: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
});
