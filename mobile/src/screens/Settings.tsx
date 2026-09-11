import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import { engine, type DevicePolicy } from "../engine";
import { useT } from "../i18n";
import type { Nav, SettingsStack } from "../nav";
import { ACCENTS, space } from "../theme";
import {
  setAppearance,
  useAppearance,
  type LabelMode,
  type Shape,
  type ThemeChoice,
} from "../settings";
import { Body, Button, Caption, Choice, Page, Section, Title, Toggle } from "../ui";

/**
 * Everything that is a setting, in the order somebody reaches for it.
 *
 * LOOK first, because it is what somebody changes on the first evening: the
 * theme, the corners, the accent, the rainbow, and how much text a control
 * shows. The same five questions GlimStone asks on every surface, so the app is
 * not a second product with its own opinions.
 *
 * Then WHEN JOBS MAY RUN, which is Autosync's pair of switches and the two
 * questions only a phone can answer. Neither ever holds a run somebody started
 * by hand: pressing the button is a decision, and a program that refused it
 * would be arguing.
 *
 * Then the three PERMISSIONS, each with the same shape - what it is for, what
 * goes wrong without it, and one button. Android grants them in three different
 * ways and there is nothing to be done about that; what this screen can do is
 * make them read as one list rather than a scavenger hunt.
 */
export function Settings() {
  const nav = useNavigation<Nav<SettingsStack>>();
  const { t, lang } = useT();
  const look = useAppearance();

  const [granted, setGranted] = useState<boolean | null>(null);
  const [possible, setPossible] = useState(true);
  const [notify, setNotify] = useState<boolean | null>(null);
  const [doze, setDoze] = useState<boolean | null>(null);
  const [running, setRunning] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<DevicePolicy | null>(null);

  const refresh = useCallback(async () => {
    const [access, can, alive, device, exempt] = await Promise.all([
      engine.storageGranted(),
      engine.storagePossible(),
      engine.alive(),
      engine.devicePolicy(),
      engine.batteryExempt(),
    ]);
    setGranted(access);
    setPossible(can);
    setRunning(alive);
    setPolicy(device);
    setDoze(exempt);
    setNotify(await notificationsGranted());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-read on return, because two of the three permissions are granted
  // SOMEWHERE ELSE. Neither has a result callback: somebody leaves for a system
  // page, flips a switch and comes back, and nothing tells the app it happened.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  const setConditions = async (next: Partial<DevicePolicy>) => {
    const merged = { ...(policy ?? EMPTY), ...next };
    setPolicy(merged);
    await engine.setDevicePolicy(merged.onlyCharging, merged.onlyWifi);
    refresh();
  };

  // Which of the two is holding things up, said in the app's own words rather
  // than the engine's. The engine is told a sentence for its log; a screen that
  // repeated that sentence would be showing English to somebody reading German.
  const held =
    policy?.onlyCharging && !policy.charging
      ? t("phone.heldCharging")
      : policy?.onlyWifi && policy.metered
        ? t("phone.heldMetered")
        : "";

  return (
    <Page>
      <Section title={t("look.theme")}>
        <Choice<ThemeChoice>
          value={look.theme}
          onChange={(theme) => setAppearance({ theme })}
          options={[
            { value: "system", label: t("phone.themeSystem") },
            { value: "dark", label: t("look.dark") },
            { value: "light", label: t("look.light") },
          ]}
        />
      </Section>

      <Section title={t("look.corners")} hint={t("look.cornersHint")}>
        <Choice<Shape>
          value={look.shape}
          onChange={(shape) => setAppearance({ shape })}
          options={[
            { value: "round", label: t("look.round") },
            { value: "soft", label: t("look.soft") },
            { value: "square", label: t("look.square") },
          ]}
        />
      </Section>

      <Section title={t("look.colors")} hint={t("look.rainbowHint")}>
        <Caption>{t("look.accent")}</Caption>
        <Choice
          value={look.accent}
          onChange={(accent) => setAppearance({ accent })}
          options={ACCENTS.map((a) => ({ value: a.hex, label: a.name, colour: a.hex }))}
        />
        <Toggle
          label={t("look.rainbowOn")}
          hint={t("look.rainbowHint")}
          value={look.rainbow}
          onChange={(rainbow) => setAppearance({ rainbow })}
        />
        <Toggle
          label={t("look.rainbowReactive")}
          hint={t("look.reactiveHint")}
          value={look.rainbowReactive}
          disabled={!look.rainbow}
          onChange={(rainbowReactive) => setAppearance({ rainbowReactive })}
        />
      </Section>

      <Section title={t("look.labels")} hint={t("look.labelsHint")}>
        <Choice<LabelMode>
          value={look.labels}
          onChange={(labels) => setAppearance({ labels })}
          options={[
            { value: "text", label: t("look.labelText") },
            { value: "textGlyph", label: t("look.labelTextGlyph") },
            { value: "glyph", label: t("look.labelGlyph") },
            { value: "reactive", label: t("look.labelReactive") },
          ]}
        />
      </Section>

      <Section title={t("look.language")}>
        <Button label={langName(lang)} glyph="🌐" onPress={() => nav.navigate("Language")} />
      </Section>

      <Section title={t("phone.schedule")}>
        <Toggle
          label={t("phone.charging")}
          hint={t("phone.chargingHint")}
          value={Boolean(policy?.onlyCharging)}
          onChange={(onlyCharging) => setConditions({ onlyCharging })}
        />
        <Toggle
          label={t("phone.wifi")}
          hint={t("phone.wifiHint")}
          value={Boolean(policy?.onlyWifi)}
          onChange={(onlyWifi) => setConditions({ onlyWifi })}
        />
        {/* What the switches are DOING right now. A condition whose consequence
            is invisible is a condition somebody waits all evening for. */}
        {held ? <Body>{held}</Body> : null}
      </Section>

      <Section title={t("phone.access")}>
        {granted ? (
          <Body>{t("phone.accessOn")}</Body>
        ) : possible ? (
          <>
            <Body>{t("phone.accessOff")}</Body>
            <Button
              label={t("phone.accessAsk")}
              glyph="🔓"
              tone="accent"
              onPress={engine.openStorageSettings}
            />
          </>
        ) : (
          <Body>{t("phone.accessNone")}</Body>
        )}
      </Section>

      <Section title={t("phone.notify")}>
        {notify ? (
          <Body>{t("phone.notifyOn")}</Body>
        ) : (
          <>
            <Body>{t("phone.notifyOff")}</Body>
            <Button
              label={t("phone.notifyAsk")}
              glyph="🔔"
              tone="accent"
              onPress={() => askNotifications().then(refresh)}
            />
          </>
        )}
      </Section>

      <Section title={t("phone.doze")}>
        {doze ? (
          <Body>{t("phone.dozeOn")}</Body>
        ) : (
          <>
            <Body>{t("phone.dozeOff")}</Body>
            <Button
              label={t("phone.dozeAsk")}
              glyph="⏱"
              tone="accent"
              onPress={() => engine.askBatteryExemption().catch(() => {})}
            />
          </>
        )}
      </Section>

      <Section title={t("engine.title")} hint={t("phone.engineHint")}>
        <Body>{running ? t("phone.engineOn") : t("phone.engineOff")}</Body>
        <View style={styles.actions}>
          {running ? (
            <Button
              label={t("phone.engineStop")}
              glyph="■"
              onPress={() => engine.stop().then(refresh)}
            />
          ) : (
            <Button
              label={t("phone.engineStart")}
              glyph="▶"
              tone="accent"
              onPress={() => engine.start().then(refresh)}
            />
          )}
        </View>
      </Section>

      <Section title={t("settings.about")}>
        <Title>{`ArrowLoop ${Constants.expoConfig?.version ?? "?"}`}</Title>
        <Caption>{t("about.body")}</Caption>
        <View style={styles.actions}>
          <Button
            label={t("about.repo")}
            glyph="↗"
            onPress={() => Linking.openURL("https://github.com/junkerderprovinz/arrowloop")}
          />
        </View>
      </Section>
    </Page>
  );
}

const EMPTY: DevicePolicy = {
  onlyCharging: false,
  onlyWifi: false,
  charging: true,
  metered: false,
  holding: "",
};

/**
 * The notification permission, which really is a dialog with an Allow button.
 *
 * React Native's own PermissionsAndroid rather than anything native of ours:
 * this is the one Android permission that still works the way permissions used
 * to, and the framework already carries the Activity plumbing a request needs.
 *
 * Below Android 13 there is no permission to ask for and notifications simply
 * work, so the answer there is yes rather than a prompt that cannot be shown.
 */
const POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS" as const;

export async function notificationsGranted(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return true;
  try {
    return await PermissionsAndroid.check(POST_NOTIFICATIONS as never);
  } catch {
    return false;
  }
}

export async function askNotifications(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return true;
  try {
    const answer = await PermissionsAndroid.request(POST_NOTIFICATIONS as never);
    return answer === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function langName(code: string): string {
  // Imported lazily rather than at the top, because LANGUAGES is the only
  // thing this needs from a module that carries forty tables behind it.
  const { LANGUAGES } = require("../i18n") as typeof import("../i18n");
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.sm },
});
