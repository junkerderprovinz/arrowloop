import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Glyph } from "./glyphs";
import { radiusFor, space, text, TOUCH } from "./theme";
import { InfoBubble, useTheme } from "./ui";

/**
 * The things somebody types into.
 *
 * Separate from ui.tsx because an input carries a second concern every other
 * control is free of: the keyboard. What kind it opens, whether it corrects
 * what is typed, and whether it grows - a path with autocorrect on becomes a
 * different path, and a phone that helpfully capitalises the first letter of
 * `/storage/emulated` has broken it.
 */

export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline,
  secret,
  keyboard,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secret?: boolean;
  keyboard?: "default" | "numeric";
}) {
  const { p, radius } = useTheme();
  const [hidden, setHidden] = useState(Boolean(secret));
  return (
    <View style={styles.field}>
      {/* The explanation rides BESIDE the label in an (i) rather than sitting
          under the input as prose. jdp: "in der app sollen auch alle infotexte
          in eine i infobubble." Which is the house rule everywhere else in this
          product, and on a phone it buys something the desktop only gets a
          little of: rclone's help for one option runs to four lines, and four
          lines under every field turns a form of six into a page of scrolling
          before a single thing has been typed. */}
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: p.text }]}>{label}</Text>
        {hint ? <InfoBubble tip={hint} /> : null}
      </View>
      <View style={styles.row}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={p.textMuted}
          secureTextEntry={hidden}
          multiline={multiline}
          keyboardType={keyboard === "numeric" ? "number-pad" : "default"}
          // OFF, all of it. A path, a pattern and a cron expression are not
          // prose: autocorrect rewrites them, autocapitalise breaks them, and
          // the phone's suggestion bar offers words from a language nobody is
          // writing in here.
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={[
            styles.input,
            {
              color: p.text,
              // One shade deeper than the card, and no line around it. A drawn
              // border is what this language does not have: a field is a well,
              // and a well is a darker surface.
              backgroundColor: p.surface2,
              borderRadius: radius.control,
              minHeight: multiline ? TOUCH * 2 : TOUCH,
              textAlignVertical: multiline ? "top" : "center",
            },
          ]}
        />
        {secret ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            android_ripple={{ color: p.hover }}
            style={[styles.eye, { backgroundColor: p.surface3, borderRadius: radius.control }]}
          >
            {/* The app's own marks. This was 👁 and 🚫 - two colour emoji from
                the phone's own font, at the phone's own weight, next to a form
                drawn entirely in this app's line. The desktop's password field
                has carried IconVisible and IconHidden all along. */}
            <Glyph name={hidden ? "IconVisible" : "IconHidden"} color={p.text} size={18} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  labelRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: { flexDirection: "row", gap: space.sm, alignItems: "stretch" },
  label: { fontSize: text.body, fontWeight: "600" },
  input: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: text.body,
  },
  eye: { width: TOUCH, alignItems: "center", justifyContent: "center" },
});

export { radiusFor };
