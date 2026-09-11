import { useNavigation } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LANGUAGES, useT } from "../i18n";
import { flagEmoji } from "../../../web/src/lib/flagEmoji";
import { contrastOn, space, text } from "../theme";
import { Caption, Page, Title, useTheme } from "../ui";

/**
 * Forty-two languages, the same list the container offers.
 *
 * Each one named in ITSELF rather than in the language currently on screen.
 * Somebody looking for Czech is looking for "Čeština", and a list that says
 * "Tschechisch" is a list they have to translate back before they can use it.
 *
 * There is deliberately no "automatic" entry. That entry looks like an option
 * and is an excuse: it fails to answer the only question somebody opens this
 * list to ask, which is which language is running right now. The phone's own
 * locale is what a fresh install starts on, and the list shows where that
 * landed.
 */
export function Language() {
  const nav = useNavigation();
  const { t, lang, setLang } = useT();
  const { p, radius, accent } = useTheme();

  return (
    <Page>
      <Title>{t("look.language")}</Title>
      {/* No sentence here. The one that used to sit under the heading was
          about whether controls show their words, borrowed because it read as
          roughly language-shaped - and forty-two names in their own scripts
          need no introduction anyway. */}
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
                  // No border. The chosen row is a filled one, the way this
                  // language separates every other surface: by shade.
                  backgroundColor: on ? accent : p.surface,
                  borderRadius: radius.control,
                },
              ]}
            >
              {/* The flag as the regional-indicator pair, which on Android IS
                  a flag. The web draws these from a sprite because Windows
                  renders the same two codepoints as a two-letter tag in its own
                  emoji font - a Microsoft policy rather than a bug - and that
                  constraint simply does not exist here. */}
              <Text style={styles.flag}>{flagEmoji(language.flag)}</Text>
              <Text style={[styles.label, { color: on ? contrastOn(accent) : p.text }]}>
                {language.label}
              </Text>
              <Text style={[styles.code, { color: on ? contrastOn(accent) : p.textMuted }]}>
                {language.code}
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
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  flag: { fontSize: 20 },
  label: { fontSize: text.body, fontWeight: "600" },
  code: { fontSize: text.caption },
});
