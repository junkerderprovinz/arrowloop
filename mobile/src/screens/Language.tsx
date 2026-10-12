import { useNavigation } from "@react-navigation/native";
import { StyleSheet, Text, View } from "react-native";
import { LANGUAGES, useT } from "../i18n";
import { flagEmoji } from "../../../web/src/lib/flagEmoji";
import { Glyph } from "../glyphs";
import { space, text } from "../theme";
import { Page, Press, useTheme } from "../ui";

/**
 * The language list, each entry named in its own language, with a check on
 * the one in use. There is no "automatic" entry: a fresh install starts on the
 * phone's locale, and the list shows which language that is. The header
 * already names the page, so the list starts at once.
 */
export function Language() {
  const nav = useNavigation();
  const { lang, setLang } = useT();
  const { p, corners, accentInk } = useTheme();

  return (
    <Page>
      <View style={styles.list}>
        {LANGUAGES.map((language) => {
          const on = language.code === lang;
          return (
            <Press
              key={language.code}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setLang(language.code);
                nav.goBack();
              }}
              android_ripple={{ color: p.hover }}
              // The chosen row is a deeper fill rather than an outline, since
              // surfaces are told apart by shade.
              style={[styles.row, { backgroundColor: on ? p.surface2 : p.surface, ...corners.card }]}
            >
              {/* Android draws the regional-indicator pair as a flag. The web
                  needs a sprite because Windows shows it as two letters. */}
              <Text style={styles.flag}>{flagEmoji(language.flag)}</Text>
              <Text style={[styles.label, { color: p.text }]}>{language.label}</Text>
              {on ? <Glyph name="IconCheck" color={accentInk} size={18} /> : null}
            </Press>
          );
        })}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: {
    paddingHorizontal: space.lg,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  // A fixed width keeps every name on one column, since emoji flags do not
  // all measure the same.
  flag: { fontSize: text.status, width: 32 },
  label: { flex: 1, fontSize: text.body },
});
