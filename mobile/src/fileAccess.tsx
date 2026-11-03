import { useEffect, useState } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";

import { api } from "./api";
import { engine } from "./engine";
import { useT, type T } from "./i18n";
import { remoteOf } from "./sides";
import { softOn, space, text } from "./theme";
import { Button, useTheme } from "./ui";

/**
 * Whether Android lets the app read the phone's folders. It is granted on a
 * settings page rather than in a dialog, so it is read again whenever the app
 * comes back to the front. Null until known, and true where Android has no
 * such permission.
 */
export function useFileAccess(): boolean | null {
  const [access, setAccess] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () =>
      Promise.all([engine.storageGranted(), engine.storagePossible()]).then(
        ([granted, possible]) => setAccess(granted || !possible),
        () => {},
      );
    void read();
    const sub = AppState.addEventListener("change", (s) => s === "active" && read());
    return () => sub.remove();
  }, []);
  return access;
}

/**
 * Says that the app may not read the phone's folders, with the way to the
 * settings page where Android grants it; there is no dialog for it.
 */
export function AccessNotice() {
  const { t } = useT();
  const { p, corners } = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: softOn(p.warnInk, 0.15), ...corners.card }]}>
      <Text style={[styles.noticeText, { color: p.warnInk }]}>
        {`${t("phone.access")} · ${t("phone.permissionDenied")}`}
      </Text>
      <Button
        label={t("phone.openSettings")}
        labelKey="phone.openSettings"
        wide={false}
        onPress={() => void engine.openStorageSettings().catch(() => {})}
      />
    </View>
  );
}

/** Whether a side is a folder on this phone rather than on a target. */
export function onPhone(side: string): boolean {
  return side !== "" && !remoteOf(side);
}

/**
 * Asks for file access before a job on the phone's folders runs, and reports
 * whether it may. Without the permission Android shows the engine those
 * folders with every other app's files left out, so the run would find
 * nothing and say it was done. Android 10 cannot grant it, and there the
 * engine's own refusal says why.
 */
export async function mayRun(sides: string[], t: T): Promise<boolean> {
  if (!sides.some(onPhone) || (await granted())) return true;
  return ask(t("access.askRun"), t("confirm.cancel"), t);
}

/** The jobs that may run now: all of them, or those that need no permission when it is refused. */
export async function mayRunAll<J extends { left: string; right: string }>(jobs: J[], t: T): Promise<J[]> {
  if (await mayRun(jobs.flatMap((j) => [j.left, j.right]), t)) return jobs;
  return jobs.filter((j) => !onPhone(j.left) && !onPhone(j.right));
}

/** mayRun for a screen that knows the job by its name only. */
export async function mayRunJob(name: string, t: T): Promise<boolean> {
  const job = (await api.config()).jobs.find((j) => j.name === name);
  return job ? mayRun([job.left, job.right], t) : true;
}

/**
 * Says so once a job on the phone's folders is saved while the app may not
 * read them, since its first run would otherwise be the first to tell.
 */
export async function tellAfterSaving(sides: string[], t: T): Promise<void> {
  if (!sides.some(onPhone) || (await granted())) return;
  await ask(t("access.askSaved"), t("access.notNow"), t);
}

async function granted(): Promise<boolean> {
  try {
    const [yes, possible] = await Promise.all([engine.storageGranted(), engine.storagePossible()]);
    return yes || !possible;
  } catch {
    // A build without the engine module has nothing to ask for.
    return true;
  }
}

/** Resolves false whichever way the question is closed, since the run waits for the permission. */
function ask(message: string, decline: string, t: T): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t("access.askTitle"),
      message,
      [
        { text: decline, style: "cancel", onPress: () => resolve(false) },
        {
          text: t("phone.openSettings"),
          onPress: () => {
            void engine.openStorageSettings().catch(() => {});
            resolve(false);
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, paddingStart: space.md },
  noticeText: { flex: 1, fontSize: text.body, fontWeight: "600" },
});
