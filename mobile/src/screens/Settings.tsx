import { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import { ORIGIN } from "../api";
import { engine } from "../engine";
import { space } from "../theme";
import { Body, Button, Caption, Card, Title } from "../ui";

/**
 * The three things that belong to the PHONE rather than to a job.
 *
 * File access, the engine process, and what this build is. Everything else a
 * person can set - schedules, exclusions, targets, the trash - belongs to a
 * job, and a job is set up at a keyboard.
 *
 * Deliberately not a copy of the desktop's settings tabs. Those hold colour
 * modes, label engines and language, and a phone answers all three from the
 * system.
 */
export function Settings() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [possible, setPossible] = useState(true);
  const [running, setRunning] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const [g, p, a] = await Promise.all([
      engine.storageGranted(),
      engine.storagePossible(),
      engine.alive(),
    ]);
    setGranted(g);
    setPossible(p);
    setRunning(a);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-read on return, because this is the one permission granted SOMEWHERE
  // ELSE. It has no dialog and no result callback: somebody leaves for a
  // system settings page, flips a switch and comes back, and nothing tells the
  // app it happened.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Title>Access to your files</Title>
        {granted ? (
          <Body>ArrowLoop can read and write the folders you point it at.</Body>
        ) : possible ? (
          <>
            <Body>
              To sync a folder, ArrowLoop has to be able to read and write it. Android grants that
              on its own settings page, which the button below opens.
            </Body>
            <Caption>
              Without it ArrowLoop still runs, but only inside its own private folder: your photos,
              downloads and documents stay out of reach.
            </Caption>
            <View style={styles.actions}>
              <Button label="Open the settings page" tone="accent" onPress={engine.openStorageSettings} />
            </View>
          </>
        ) : (
          // Android 10 exactly. MANAGE_EXTERNAL_STORAGE arrived in 11, and
          // requestLegacyExternalStorage is ignored for an app targeting above
          // 29 - which this one must. No button, because it would do nothing.
          <Body>
            This version of Android cannot grant an app access to your files without also giving up
            modification times, which a two-way sync cannot work without. Android 11 and later can.
          </Body>
        )}
      </Card>

      <Card>
        <Title>The engine</Title>
        <Body>
          {running === null
            ? "Checking…"
            : running
              ? `Running, and answering on ${ORIGIN}.`
              : "Not running."}
        </Body>
        <Caption>
          The engine is the whole of ArrowLoop: the same program the container and the desktop run.
          It keeps going while the screen is off, which is what the notification is for.
        </Caption>
        <View style={styles.actions}>
          {running ? (
            <Button label="Stop" onPress={() => engine.stop().then(refresh)} />
          ) : (
            <Button label="Start" tone="accent" onPress={() => engine.start().then(refresh)} />
          )}
        </View>
      </Card>

      <Card>
        <Title>This build</Title>
        <Body>ArrowLoop {Constants.expoConfig?.version ?? "?"}</Body>
        <Caption>
          The app carries its own version, separate from the engine's: an APK on a phone does not
          change when a container is pulled.
        </Caption>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
});
