import { useNavigation } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LANGUAGES, useT } from "../i18n";
import { flagEmoji } from "../../../web/src/lib/flagEmoji";
import { contrastOn, space, text } from "../theme";
import { Caption, Page, Title, useTheme } from "../ui";

/**
 * The language list, each entry named in its own language. There is no
 * "automatic" entry: a fresh install starts on the phone's locale, and the
 * list shows which language that is.
 */
export function Language() {
  const nav = useNavigation();
  const { t, lang, setLang } = useT();
  const { p, radius, accent } = useTheme();

  return (
    <Page>
      <Title>{t("look.language")}</Title>
      <View style={styles.list}>
        {LANGUAGES.map((language) => {
          const on = language.code === lang;
          return (
            <Pressable
              key={language.code}
              onPress={() => {
                setLang(language.code);
                nav.goBack();
              }}
              android_ripple={{ color: p.hover }}
              style={[
                styles.row,
                {
                  backgroundColor: on ? accent : p.surface,
                  borderRadius: radius.control,
                },
              ]}
            >
              {/* Android draws the regional-indicator pair as a flag. The web
                  needs a sprite because Windows shows it as two letters. */}
              <Text style={styles.flag}>{flagEmoji(language.flag)}</Text>
              <Text style={[styles.label, { color: on ? contrastOn(accent) : p.text }]}>
                {language.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  // No border: surfaces are separated by shade, and the chosen row is filled.
  row: {
    paddingHorizontal: space.lg,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  flag: { fontSize: 20 },
  label: { fontSize: text.body, fontWeight: "600" },
});
