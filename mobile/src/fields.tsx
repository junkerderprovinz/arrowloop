import DateTimePicker from "@react-native-community/datetimepicker";
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

/**
 * A time, picked on Android's own clock.
 *
 * It used to be a plain HH:MM field, on the reasoning that the dialog costs two
 * taps and a confirm for a value somebody types faster. That reasoning holds
 * for a keyboard and not for a thumb: jdp asked for "dieser bekannte radial
 * zeitwähler", and he is right that a time is the one value a phone already has
 * a better control for than a text box - the clock face is where everybody on
 * this platform has set an alarm.
 *
 * It still looks like every other field, which is the part worth keeping: the
 * same well, the same label row, the same (i). Only the gesture changes.
 *
 * The VALUE stays a string in HH:MM, not a Date. The schedule is a cron
 * expression and its builder speaks hours and minutes; handing it a Date would
 * mean a timezone and a day in a value that has neither.
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
          // A Date only because the picker's own API takes one. Today's date
          // with the stored hour and minute on it: nothing reads the day back.
          value={dateAt(hour, minute)}
          mode="time"
          // The clock face rather than the two spinners. `spinner` is the
          // other Android offers, and it is the one nobody means by "the
          // familiar picker".
          display="clock"
          // 24 hours, because the whole product writes times that way and a
          // dialog that says 3:00 PM over a field that says 15:00 is two
          // answers to one question.
          is24Hour
          onChange={(event, picked) => {
            // Dismissed counts as "leave it alone". Android reports a cancel as
            // an event type rather than as a missing date, and treating that as
            // a change would write the time the dialog happened to open on.
            setOpen(false);
            if (event.type !== "set" || !picked) return;
            onChange(formatTime(picked.getHours(), picked.getMinutes()));
          }}
        />
      ) : null}
    </View>
  );
}

/** HH:MM, or a sensible three in the morning for anything unreadable. Same
 *  fallback the shared schedule parser takes, so a broken value does not mean
 *  two different times on two surfaces. */
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
  // The same well as an input, laid out to hold one centred line instead of a
  // text cursor.
  timeBox: { justifyContent: "center" },
  timeText: { fontSize: text.body },
});

export { radiusFor };
