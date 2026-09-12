import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "./api";
import { useT } from "./i18n";
import { Glyph } from "./glyphs";
import { SCRIM, space, text, TOUCH } from "./theme";
import { Body, Button, Caption, useTheme } from "./ui";

/**
 * Picking a folder instead of typing one.
 *
 * jdp: "den lokalen ordner und den ordner auf der cloud soll man per
 * fileexplorer einfach auswählen können. da fehlt ein ordner button."
 *
 * A typed path is where a job goes wrong quietly: a folder that does not exist
 * is a perfectly valid string, so the first anybody hears of a typo is a run
 * that copied nothing - or one that made the wrong tree and then kept it in
 * step with the right one. On a phone it is worse than on a desktop, because
 * `/storage/emulated/0/DCIM/Camera` has to be typed on a thumb keyboard with
 * autocorrect switched off.
 *
 * The FIELD STAYS. This is a button beside it, the same way the container does
 * it, because a path can also be a target's own name with a colon - which no
 * folder listing produces - and because pasting a path somebody was given is
 * faster than walking to it.
 *
 * IT BROWSES THE PHONE, and the targets are offered as ENTRIES rather than
 * walked into. The engine's browse endpoint reads a local directory; there is
 * no listing for what is inside a Nextcloud, so offering to walk in would be a
 * door that opens onto nothing. Picking a target fills the field with `name:`
 * and leaves the folder after it to be typed, which is the same trade the
 * container makes on the same endpoint.
 */
export function FolderPicker({
  visible,
  start,
  targets = [],
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Where to begin. Anything unusable simply starts at the top. */
  start?: string;
  /** Configured targets, offered above the folders at the top level. */
  targets?: string[];
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const { p, radius } = useTheme();
  const [at, setAt] = useState("");
  const [parent, setParent] = useState("");
  const [entries, setEntries] = useState<{ name: string; path: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = useCallback(async (path: string) => {
    setBusy(true);
    setError("");
    try {
      const answer = await api.browse(path || undefined);
      setAt(answer.path ?? path);
      setParent(answer.parent ?? "");
      setEntries(answer.entries ?? []);
    } catch (e) {
      // The error names the folder rather than replacing the listing, so a
      // folder somebody cannot read does not throw them back to the top.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Re-seeded on every open rather than resuming where the last visit ended:
  // this opens from a specific field, and that field's value is the answer to
  // "where were we". A target's name is not a path, so it starts at the top.
  useEffect(() => {
    if (!visible) return;
    const from = start && !start.includes(":") ? start : "";
    void go(from);
  }, [visible, start, go]);

  const row = (label: string, onPress: () => void, glyph: string) => (
    <Pressable
      key={label}
      onPress={onPress}
      android_ripple={{ color: p.hover }}
      style={[styles.row, { backgroundColor: p.surface2, borderRadius: radius.control }]}
    >
      <Glyph name={glyph} color={p.text} size={18} />
      <Text style={[styles.rowText, { color: p.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.ground} onPress={onClose}>
        {/* The card swallows presses so that tapping inside it does not count
            as tapping the ground behind it. */}
        <Pressable
          style={[styles.card, { backgroundColor: p.surface, borderRadius: radius.card }]}
          onPress={() => {}}
        >
          <Body>{t("pick.title")}</Body>
          <Caption>{at || t("pick.roots")}</Caption>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {at ? row(t("pick.up"), () => void go(parent), "IconUp") : null}
            {/* Targets at the top level only. Below that they would read as a
                folder inside the one being looked at. */}
            {!at
              ? targets.map((name) =>
                  row(name, () => onPick(`${name}:`), "IconTargets"),
                )
              : null}
            {entries.map((entry) => row(entry.name, () => void go(entry.path), "IconFolder"))}
            {!busy && !entries.length && !error ? <Caption>{t("pick.empty")}</Caption> : null}
            {error ? <Caption>{error}</Caption> : null}
          </ScrollView>

          <View style={styles.actions}>
            <Button label={t("pick.cancel")} labelKey="pick.cancel" onPress={onClose} />
            {/* Chooses the folder somebody is STANDING IN, which is what the
                path at the top says. Absent at the very top, where there is no
                folder to choose - only a list of roots. */}
            {at ? (
              <Button
                label={t("pick.choose")}
                labelKey="pick.choose"
                tone="accent"
                onPress={() => onPick(at)}
              />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: SCRIM,
    justifyContent: "center",
    padding: space.md,
  },
  card: { padding: space.md, gap: space.sm, maxHeight: "80%" },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: TOUCH,
    paddingHorizontal: space.md,
    marginBottom: space.xs,
  },
  rowText: { flex: 1, fontSize: text.body },
  actions: { flexDirection: "row", gap: space.sm, justifyContent: "flex-end" },
});
