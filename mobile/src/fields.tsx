import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Glyph } from "./glyphs";
import { useT } from "./i18n";
import { radiusFor, space, text, TOUCH } from "./theme";
import { Body, Button, InfoBubble, Press, Row, useTheme } from "./ui";

export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline,
  secret,
  keyboard,
  onBlur,
  error,
  short,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secret?: boolean;
  keyboard?: "default" | "numeric";
  onBlur?: () => void;
  /** Why the value was refused, said under the field it concerns. */
  error?: string;
  /** A box for a few characters, which fits beside its name on a phone. */
  short?: boolean;
}) {
  const { p, corners } = useTheme();
  const [hidden, setHidden] = useState(Boolean(secret));
  return (
    <View style={styles.field}>
      <View style={short ? styles.beside : styles.field}>
        <View style={[styles.labelRow, short ? styles.besideLabel : null]}>
          <Text style={[styles.label, { color: p.text, flexShrink: 1 }]}>{label}</Text>
          {hint ? <InfoBubble tip={hint} /> : null}
        </View>
        <View style={[styles.row, short ? styles.shortBox : null]}>
          <TextInput
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
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
                ...corners.control,
                minHeight: multiline ? TOUCH * 2 : TOUCH,
                textAlignVertical: multiline ? "top" : "center",
              },
            ]}
          />
          {secret ? (
            <Press
              onPress={() => setHidden((h) => !h)}
              android_ripple={{ color: p.hover }}
              style={[styles.eye, { backgroundColor: p.surface3, ...corners.pill }]}
            >
              <Glyph name={hidden ? "IconEye" : "IconEyeOff"} color={p.text} size={18} />
            </Press>
          ) : null}
        </View>
      </View>
      {error ? <Refusal text={error} /> : null}
    </View>
  );
}

/** What the engine sends in place of a secret it keeps. */
export const WITHHELD = "********";

/**
 * A secret in a form that is saved as a whole. Once stored it shows as Saved
 * with a Change button, since the engine never sends it back and a box could
 * only show dots that are not the secret. While it is being changed the
 * stored one stays until something is typed, and Keep goes back to it.
 */
export function SecretField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const { t } = useT();
  const [changing, setChanging] = useState(false);
  const stored = value === WITHHELD;
  if (stored && !changing) {
    return (
      <Row
        label={label}
        hint={hint}
        control={
          <View style={styles.saved}>
            <Body muted>{t("notify.saved")}</Body>
            <Button label={t("notify.change")} labelKey="notify.change" onPress={() => setChanging(true)} />
          </View>
        }
      />
    );
  }
  return (
    <View style={styles.field}>
      <Field label={label} hint={hint} secret value={stored ? "" : value} onChange={onChange} placeholder={placeholder} />
      {changing ? (
        <Button
          label={t("notify.keep")}
          labelKey="notify.keep"
          onPress={() => {
            setChanging(false);
            onChange(WITHHELD);
          }}
        />
      ) : null}
    </View>
  );
}

/** Why a value was refused, under what it concerns. */
export function Refusal({ text }: { text: string }) {
  const { p } = useTheme();
  return <Text style={[styles.error, { color: p.failInk }]}>{text}</Text>;
}

/**
 * A field for a number that is written through as it is typed. The text being
 * typed is kept here: shown from the stored value, the box would refill itself
 * the moment it was emptied to type another number. An empty box writes
 * nothing, and shows the stored value again once it is left.
 */
export function NumberField({
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
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <Field
      label={label}
      hint={hint}
      keyboard="numeric"
      short
      value={typed ?? value}
      onChange={(next) => {
        setTyped(next);
        if (next.trim()) onChange(next);
      }}
      onBlur={() => setTyped(null)}
    />
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
  const { p, corners } = useTheme();
  const [open, setOpen] = useState(false);
  const { hour, minute } = readTime(value);

  return (
    <View style={styles.beside}>
      <View style={[styles.labelRow, styles.besideLabel]}>
        <Text style={[styles.label, { color: p.text, flexShrink: 1 }]}>{label}</Text>
        {hint ? <InfoBubble tip={hint} /> : null}
      </View>
      <Press
        onPress={() => setOpen(true)}
        android_ripple={{ color: p.hover }}
        style={[
          styles.input,
          styles.timeBox,
          styles.shortBox,
          { backgroundColor: p.surface2, ...corners.control, minHeight: TOUCH },
        ]}
      >
        <Text style={[styles.timeText, { color: p.text }]}>{formatTime(hour, minute)}</Text>
      </Press>
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
  error: { fontSize: text.subline, lineHeight: 18 },
  input: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: text.body,
  },
  eye: { width: TOUCH, alignItems: "center", justifyContent: "center" },
  saved: { flexDirection: "row", alignItems: "center", gap: space.sm },
  timeBox: { justifyContent: "center" },
  // Where the name is too long for one line beside the box, the box moves
  // under it and keeps the row's end.
  beside: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    columnGap: space.md,
    rowGap: space.xs,
  },
  besideLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 180 },
  shortBox: { width: 104 },
  timeText: { fontSize: text.body },
});

export { radiusFor };
