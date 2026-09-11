import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { radiusFor, space, text, TOUCH } from "./theme";
import { Caption, useTheme } from "./ui";

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
      <Text style={[styles.label, { color: p.text }]}>{label}</Text>
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
              backgroundColor: p.surface2,
              borderColor: p.border,
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
            <Text style={{ color: p.text, fontSize: text.title }}>{hidden ? "👁" : "🚫"}</Text>
          </Pressable>
        ) : null}
      </View>
      {hint ? <Caption>{hint}</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  row: { flexDirection: "row", gap: space.sm, alignItems: "stretch" },
  label: { fontSize: text.body, fontWeight: "600" },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: text.body,
  },
  eye: { width: TOUCH, alignItems: "center", justifyContent: "center" },
});

export { radiusFor };
