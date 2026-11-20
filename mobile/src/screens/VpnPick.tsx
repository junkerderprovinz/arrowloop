import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api } from "../api";
import { Glyph, VpnMark, vpnTile } from "../glyphs";
import { useT } from "../i18n";
import type { MoreStack, Nav } from "../nav";
import { space, text, TOUCH } from "../theme";
import { Body, Caption, Empty, Page, Press, ReadmeButton, ReadmeRow, Title, useTheme, WORDMARK, WORDMARK_MOST, WORDMARK_ON_SUB } from "../ui";
import { pickGroups, vpnMark, wordmarkWidth } from "../vpn";
import { errorText } from "../../../web/src/lib/errorText";
import type { VpnState } from "../../../web/src/lib/vpn";

/**
 * The providers as README buttons with their logos, under a search, and a
 * WireGuard server of one's own after them, as the web's picker window has
 * them. Picking one opens its form.
 */
export function VpnPick() {
  const nav = useNavigation<Nav<MoreStack>>();
  const { t } = useT();
  const { p, scheme, accent, accentContrast, corners } = useTheme();
  const [vpn, setVpn] = useState<VpnState | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.vpn().then(setVpn, (e) => setError(errorText(t, e)));
  }, [t]);

  if (!vpn) return <Empty title={t("vpn.reading")} detail={error || undefined} />;

  const groups = pickGroups(vpn, query, t);

  return (
    <Page>
      <Caption>{t("vpn.pickHint")}</Caption>
      <View style={[styles.search, { backgroundColor: p.surface2, ...corners.control }]}>
        <Glyph name="IconSearch" color={p.textMuted} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("vpn.search")}
          placeholderTextColor={p.textSub}
          accessibilityLabel={t("vpn.search")}
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
        <Body muted>{t("vpn.searchNone", { query: query.trim() })}</Body>
      ) : (
        groups.map((g) => (
          <View key={g.title} style={styles.group}>
            <Title>{g.title}</Title>
            <ReadmeRow>
              {g.tiles.map((x) => {
                const tile = vpnTile(x.id) ?? { color: accent, ink: accentContrast };
                const mark = vpnMark(x.id);
                // A wordmark keeps its own aspect, shrunk onto the name's line above a second line.
                const high = x.sub ? WORDMARK_ON_SUB : WORDMARK;
                const box = mark?.wordmark
                  ? { width: wordmarkWidth(mark, high, (WORDMARK_MOST * high) / WORDMARK), height: high }
                  : { width: MARK_W, height: MARK_H };
                return (
                  <ReadmeButton
                    key={x.id}
                    label={x.name}
                    sub={x.sub}
                    hint={x.hint}
                    tile={tile}
                    wordmark={mark?.wordmark}
                    mark={(lit, ink) => (
                      <VpnMark
                        provider={x.id}
                        {...box}
                        scheme={scheme}
                        lit={lit}
                        color={lit ? ink : p.textSub}
                      />
                    )}
                    onPress={() => nav.navigate("VpnEdit", { provider: x.id })}
                  />
                );
              })}
            </ReadmeRow>
          </View>
        ))
      )}
    </Page>
  );
}

// The README's mark box.
const MARK_W = 32;
const MARK_H = 25;

const styles = StyleSheet.create({
  group: { gap: space.md },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH, paddingStart: space.md },
  input: { flex: 1, minHeight: TOUCH, fontSize: text.body },
  clear: { width: TOUCH, minHeight: TOUCH, alignItems: "center", justifyContent: "center" },
});
