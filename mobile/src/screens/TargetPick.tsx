import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type Provider } from "../api";
import { useT } from "../i18n";
import type { Nav, TargetsStack } from "../nav";
import { nameAndKind, providerHint, providerName } from "../../../web/src/lib/optionHint";
import { space } from "../theme";
import { brandTile, ProviderMark } from "../glyphs";
import { Caption, Empty, Page, ReadmeButton, ReadmeRow, Title, useTheme } from "../ui";

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

  const button = (provider: Provider) => {
    // A protocol wears one of the app's own glyphs and lights in the accent.
    const tile = brandTile(provider.mark) ?? { color: accent, ink: accentContrast };
    const { name, sub } = nameAndKind(providerName(provider, t));
    return (
      <ReadmeButton
        key={provider.id}
        label={name}
        sub={sub}
        tile={tile}
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
      <View style={styles.sections}>
        <Title>{t("targets.cloud")}</Title>
        <ReadmeRow>{clouds.map(button)}</ReadmeRow>
        <Title>{t("targets.storage")}</Title>
        <ReadmeRow>{storage.map(button)}</ReadmeRow>
        <Title>{t("targets.connections")}</Title>
        <ReadmeRow>{protocols.map(button)}</ReadmeRow>
      </View>
      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

// The README's mark box.
const MARK_W = 32;
const MARK_H = 25;

const styles = StyleSheet.create({
  sections: { gap: space.md },
});
