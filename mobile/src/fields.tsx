import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Glyph } from "./glyphs";
import { radiusFor, space, text, TOUCH } from "./theme";
import { InfoBubble, useTheme } from "./ui";

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
          // Paths, patterns and cron expressions are not prose, and
          // autocorrect or capitalisation would break them.
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={[
            styles.input,
            {
              color: p.text,
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
            <Glyph name={hidden ? "IconVisible" : "IconHidden"} color={p.text} size={18} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A time field that opens Android's clock picker. The value stays an HH:MM
 * string, since the schedule it feeds is a cron expression with no date or
 * timezone.
 */
export function TimeField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const { p, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const { hour, minute } = readTime(value);

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: p.text }]}>{label}</Text>
        {hint ? <InfoBubble tip={hint} /> : null}
      </View>
      <Pressable
        onPress={() => setOpen(true)}
        android_ripple={{ color: p.hover }}
        style={[
          styles.input,
          styles.timeBox,
          { backgroundColor: p.surface2, borderRadius: radius.control, minHeight: TOUCH },
        ]}
      >
        <Text style={[styles.timeText, { color: p.text }]}>{formatTime(hour, minute)}</Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          // The picker takes a Date; only its hour and minute are read back.
          value={dateAt(hour, minute)}
          mode="time"
          display="clock"
          is24Hour
          onChange={(event, picked) => {
            // Android reports a cancel as an event type, not as a missing date.
            setOpen(false);
            if (event.type !== "set" || !picked) return;
            onChange(formatTime(picked.getHours(), picked.getMinutes()));
          }}
        />
      ) : null}
    </View>
  );
}

/** Parses HH:MM, falling back to 03:00 like the shared schedule parser. */
function readTime(raw: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((raw ?? "").trim());
  if (!m) return { hour: 3, minute: 0 };
  const hour = Math.min(23, Math.max(0, parseInt(m[1] ?? "3", 10)));
  const minute = Math.min(59, Math.max(0, parseInt(m[2] ?? "0", 10)));
  return { hour, minute };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function dateAt(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
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
  timeBox: { justifyContent: "center" },
  timeText: { fontSize: text.body },
});

export { radiusFor };
