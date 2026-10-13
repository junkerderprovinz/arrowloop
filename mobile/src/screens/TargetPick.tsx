import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api, type Provider } from "../api";
import { useT } from "../i18n";
import type { Nav, MoreStack } from "../nav";
import { matchesQuery } from "../../../web/src/lib/fold";
import { nameAndKind, providerHint, providerName } from "../../../web/src/lib/optionHint";
import { space, text, TOUCH } from "../theme";
import { brandTile, Glyph, ProviderMark } from "../glyphs";
import { Body, Caption, Empty, Page, Press, ReadmeButton, ReadmeRow, Title, useTheme } from "../ui";

/**
 * Picks the kind of storage for a new target, as README buttons matching the
 * web app's, under a search that narrows every group at once. The engine
 * lists only the providers compiled into this build. Only protocols carry a
 * hint, since "SMB" or "WebDAV" does not say what it is.
 */
export function TargetPick() {
  const nav = useNavigation<Nav<MoreStack>>();
  const { t } = useT();
  const { p, scheme, accent, accentContrast, corners } = useTheme();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.storage().then(
      (s) => setProviders(s.providers),
      (e: Error) => setError(e.message),
    );
  }, []);

  if (!providers) return <Empty title={t("history.working")} detail={error || undefined} />;

  // By the name shown and by rclone's own, which is what a guide online calls it.
  const found = providers.filter((x) => matchesQuery(query, [providerName(x, t), x.name, x.backend]));
  const groups = [
    { title: t("targets.cloud"), items: found.filter((x) => x.group === "cloud") },
    { title: t("targets.storage"), items: found.filter((x) => x.group === "storage") },
    { title: t("targets.connections"), items: found.filter((x) => x.group === "protocol") },
  ].filter((g) => g.items.length > 0);
  const tile = (id: string, fallback: string) => {
    const known = providers.find((x) => x.id === id);
    return known ? providerName(known, t) : fallback;
  };

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
      <View style={[styles.search, { backgroundColor: p.surface2, ...corners.control }]}>
        <Glyph name="IconSearch" color={p.textMuted} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("targets.search")}
          placeholderTextColor={p.textMuted}
          accessibilityLabel={t("targets.search")}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: p.text }]}
        />
        {query ? (
          <Press
            onPress={() => setQuery("")}
            accessibilityRole="button"
            accessibilityLabel={t("settings.searchClear")}
            style={styles.clear}
          >
            <Glyph name="IconClose" color={p.textSub} size={18} />
          </Press>
        ) : null}
      </View>
      {groups.length === 0 ? (
        <Body muted>{t("targets.searchNone", { query: query.trim(), s3: tile("s3", "S3"), webdav: tile("webdav", "WebDAV") })}</Body>
      ) : (
        <View style={styles.sections}>
          {groups.map((g) => (
            <View key={g.title} style={styles.sections}>
              <Title>{g.title}</Title>
              <ReadmeRow>{g.items.map(button)}</ReadmeRow>
            </View>
          ))}
        </View>
      )}
      {error ? <Caption>{error}</Caption> : null}
    </Page>
  );
}

// The README's mark box.
const MARK_W = 32;
const MARK_H = 25;

const styles = StyleSheet.create({
  sections: { gap: space.md },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH, paddingStart: space.md },
  input: { flex: 1, minHeight: TOUCH, fontSize: text.body },
  clear: { width: TOUCH, minHeight: TOUCH, alignItems: "center", justifyContent: "center" },
});
