import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "./api";
import { useT } from "./i18n";
import { Glyph } from "./glyphs";
import { SCRIM, space, text, TOUCH } from "./theme";
import { Body, Button, Caption, useTheme } from "./ui";

/**
 * A dialog for choosing a folder on the phone instead of typing its path.
 * The engine's browse endpoint lists local directories only, so targets are
 * offered as entries that fill in `name:` and leave the folder to be typed.
 */
export function FolderPicker({
  visible,
  start,
  targets = [],
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Where to begin; anything unusable starts at the top. */
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
  /** The name of the folder being made, or null while none is. */
  const [naming, setNaming] = useState<string | null>(null);

  const go = useCallback(async (path: string) => {
    setBusy(true);
    setError("");
    try {
      const answer = await api.browse(path || undefined);
      setAt(answer.path ?? path);
      setParent(answer.parent ?? "");
      setEntries(answer.entries ?? []);
    } catch (e) {
      // The listing stays, so an unreadable folder does not jump back to the top.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Makes the folder and opens it, since it is usually the one about to be chosen. */
  const make = async () => {
    const name = (naming ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      await api.makeDir(at, name);
      setNaming(null);
      await go(`${at}/${name}`.replace(/\/{2,}/g, "/"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Every open starts from the field's own value; a target's name is not a
  // path, so it starts at the top.
  useEffect(() => {
    if (!visible) return;
    setNaming(null);
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
        {/* Swallows presses so a tap inside does not close the dialog. */}
        <Pressable
          style={[styles.card, { backgroundColor: p.surface, borderRadius: radius.card }]}
          onPress={() => {}}
        >
          <Body>{t("pick.title")}</Body>
          <Caption>{at || t("pick.roots")}</Caption>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {at ? row(t("pick.up"), () => void go(parent), "IconUp") : null}
            {/* Targets at the top level only, where they cannot pass for a subfolder. */}
            {!at
              ? targets.map((name) =>
                  row(name, () => onPick(`${name}:`), "IconTargets"),
                )
              : null}
            {entries.map((entry) => row(entry.name, () => void go(entry.path), "IconFolder"))}
            {!busy && !entries.length && !error ? <Caption>{t("pick.empty")}</Caption> : null}
            {error ? <Caption>{error}</Caption> : null}
          </ScrollView>

          {/* The top level lists storage volumes, where no folder can be made. */}
          {at && naming === null ? (
            <Button label={t("pick.newFolder")} labelKey="pick.newFolder" onPress={() => setNaming("")} />
          ) : null}
          {at && naming !== null ? (
            <View style={styles.naming}>
              <TextInput
                value={naming}
                onChangeText={setNaming}
                placeholder={t("pick.newFolder")}
                placeholderTextColor={p.textSub}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => void make()}
                style={[
                  styles.name,
                  { backgroundColor: p.surface2, borderRadius: radius.control, color: p.text },
                ]}
              />
              <Button
                label={t("pick.choose")}
                labelKey="pick.choose"
                tone="accent"
                wide={false}
                disabled={!naming.trim() || busy}
                onPress={() => void make()}
              />
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button label={t("pick.cancel")} labelKey="pick.cancel" onPress={onClose} />
            {/* Chooses the folder currently open, so there is none at the top. */}
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
  naming: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  name: { flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, fontSize: text.body },
});
