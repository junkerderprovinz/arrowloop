import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { api } from "../api";
import { heldKey } from "../deviceConditions";
import { engine, type DeviceConditions, type DevicePolicy } from "../engine";
import { useT } from "../i18n";
import type { Nav, SettingsStack } from "../nav";
import { ACCENTS, DEFAULT_ACCENT, RAINBOW, space } from "../theme";
import {
  setAppearance,
  settings as settingsApi,
  useAppearance,
  useEngineSettings,
  type BarLabelMode,
  type EngineSettings,
  type LabelMode,
  type Shape,
  type ThemeChoice,
} from "../settings";
import { GLIMSTONE_VERSION } from "../../../web/src/lib/glimstone/version";
import {
  COFFEE,
  glimstoneRelease,
  MAIL,
  PAYPAL,
  REPO,
} from "../../../web/src/lib/donate";
import { nearestPreset } from "../../../web/src/lib/colorMath";
import { flagEmoji } from "../../../web/src/lib/flagEmoji";
import { useClosingLoop, useStormUnlock } from "../eggs";
import { animateNext, useMotion, type MotionIntensity } from "../motion";
import { ColorPicker, EditableSwatch, ResetMark } from "../ColorPicker";
import { CryptoDonate } from "../donate";
import { Field } from "../fields";
import { Schedule } from "./JobEdit";
import { DonateMark, Glyph } from "../glyphs";
import {
  AxisLabel,
  Body,
  Button,
  Caption,
  Choice,
  Page,
  InfoBubble,
  Section,
  Title,
  Toggle,
  useTheme,
} from "../ui";

/**
 * The settings page: the GlimStone appearance axes first, then when jobs may
 * run, then the permissions, each with what it is for and one button.
 */
export function Settings() {
  const nav = useNavigation<Nav<SettingsStack>>();
  const { t, lang } = useT();
  const look = useAppearance();
  const { scheme, accentInk, barLabels } = useTheme();
  const { intensity: motion } = useMotion();
  const storm = useStormUnlock();
  const loop = useClosingLoop();

  const [granted, setGranted] = useState<boolean | null>(null);
  const [possible, setPossible] = useState(true);
  const [notify, setNotify] = useState<boolean | null>(null);
  const [doze, setDoze] = useState<boolean | null>(null);
  const [running, setRunning] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<DevicePolicy | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [lockable, setLockable] = useState(false);
  const [backupFile, setBackupFile] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSaid, setBackupSaid] = useState("");
  const [crypto, setCrypto] = useState(false);

  // The swatch a second press would open. One slot for both rows, so only one
  // ring shows at a time.
  const [armed, setArmed] = useState<{ kind: "accent" | "palette"; index: number } | null>(null);
  // The swatch the picker is open on.
  const [editing, setEditing] = useState<{ kind: "accent" | "palette"; index: number; hex: string } | null>(
    null,
  );

  // The preset slot that holds the live accent. It is kept in state rather than
  // recomputed, or dragging in the picker could hop the colour to another slot;
  // the nearest preset is used only when the accent changes from elsewhere.
  const [accentSlot, setAccentSlot] = useState(() => nearestPreset(ACCENTS.map((a) => a.hex), look.accent));
  const seenAccent = useRef(look.accent);
  useEffect(() => {
    if (seenAccent.current !== look.accent) {
      seenAccent.current = look.accent;
      setAccentSlot(nearestPreset(ACCENTS.map((a) => a.hex), look.accent));
    }
  }, [look.accent]);

  const palette = look.palette.length ? look.palette : RAINBOW;

  const { settings, update } = useEngineSettings(true);
  const defaults = (settings?.defaults ?? {}) as Record<string, unknown>;
  const saveDefaults = (patch: Record<string, unknown>) =>
    update({ defaults: { ...defaults, ...patch } });

  /**
   * Backs up the engine's settings and the jobs. The appearance and the lock
   * belong to this install and stay out.
   */
  const exportSettings = async () => {
    setBackupBusy(true);
    setBackupSaid("");
    try {
      const [config, current] = await Promise.all([api.config(), settingsApi.read()]);
      const where = await engine.exportSettings(
        JSON.stringify({ kind: "arrowloop-settings", version: 1, settings: current, config }, null, 2),
      );
      setBackupFile(where);
      setBackupSaid(t("settings.exported", { path: where }));
    } catch (e) {
      setBackupSaid((e as Error).message);
    } finally {
      setBackupBusy(false);
    }
  };

  const importSettings = async () => {
    setBackupBusy(true);
    setBackupSaid("");
    try {
      const text = await engine.importSettings(backupFile);
      const backup = JSON.parse(text) as {
        kind?: string;
        settings?: unknown;
        config?: { jobs?: unknown[] };
      };
      // Any parseable JSON file would otherwise overwrite the jobs.
      if (backup.kind !== "arrowloop-settings" || !backup.settings || !backup.config) {
        setBackupSaid(t("settings.importNotOurs"));
        return;
      }
      await settingsApi.write(backup.settings as EngineSettings);
      await api.writeConfig(backup.config as never);
      setBackupSaid(t("settings.imported"));
      await refresh();
    } catch (e) {
      setBackupSaid((e as Error).message);
    } finally {
      setBackupBusy(false);
    }
  };

  const refresh = useCallback(async () => {
    const [access, can, alive, device, exempt] = await Promise.all([
      engine.storageGranted(),
      engine.storagePossible(),
      // The process handle is null when the engine was already up at launch.
      engine.answering(),
      engine.devicePolicy(),
      engine.batteryExempt(),
    ]);
    setGranted(access);
    setPossible(can);
    setRunning(alive);
    setPolicy(device);
    setDoze(exempt);
    engine.hasDeviceLock().then(setLockable, () => setLockable(false));
    // Shows where a backup would go before one exists.
    setBackupFile((old) => old || "");
    engine.backupPath().then(
      (where) => setBackupFile((old) => old || where),
      () => {},
    );
    setNotify(await notificationsGranted());
    api.capabilities().then((c) => setVersion(c.version), () => setVersion(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Two of the permissions are granted on system pages with no result
  // callback, so they are read again when the app returns.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  const setConditions = async (next: Partial<DeviceConditions>) => {
    setPolicy((old) => ({ ...(old ?? EMPTY), ...next }));
    await engine.setDevicePolicy(next);
    refresh();
  };

  const heldAt = heldKey(policy);
  const held = heldAt ? t(heldAt) : "";

  return (
    <Page>
      {/* One card per appearance axis, each with its own palette position. */}
      <Section title={t("look.theme")} hue={0}>
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

      <Section title={t("look.corners")} hint={t("look.cornersHint")} hue={1}>
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

      {/* Every swatch chooses on the first press and opens the picker on a
          second. The web's reactive switch is left out, since a phone has no
          pointer. */}
      <Section title={t("look.colors")} hue={2}>
        {/* Dimmed rather than hidden while the rainbow is on, so it still shows
            which accent returns when the rainbow is switched off. */}
        <View style={[styles.axisRow, look.rainbow ? styles.dimmed : null]} pointerEvents={look.rainbow ? "none" : "auto"}>
          <View style={styles.axisRowInner}>
            <Body>{t("look.accent")}</Body>
            <View style={styles.swatches}>
              {ACCENTS.map((a, i) => {
                // The slot holding the live accent shows it, edited or not, so
                // the applied colour always has a circle to reopen.
                const mine = i === accentSlot;
                const hex = mine ? look.accent : a.hex;
                return (
                  <EditableSwatch
                    key={a.hex}
                    hex={hex}
                    // An edited slot is labelled with its hex, not the preset's name.
                    label={mine && hex.toLowerCase() !== a.hex.toLowerCase() ? hex.toUpperCase() : a.name}
                    selected={mine}
                    onPress={() => {
                      setAccentSlot(i);
                      setAppearance({ accent: hex });
                      if (armed?.kind === "accent" && armed.index === i) {
                        setEditing({ kind: "accent", index: i, hex });
                        setArmed(null);
                      } else {
                        setArmed({ kind: "accent", index: i });
                      }
                    }}
                  />
                );
              })}
            </View>
            <ResetMark
              label={t("look.accentReset")}
              disabled={look.accent.toLowerCase() === DEFAULT_ACCENT.toLowerCase()}
              onPress={() => setAppearance({ accent: DEFAULT_ACCENT })}
            />
          </View>
        </View>

        <Toggle
          label={t("look.rainbowOn")}
          hint={t("look.rainbowHint")}
          value={look.rainbow}
          hue={0}
          onChange={(rainbow) => {
            animateNext(motion);
            setAppearance({ rainbow });
          }}
        />

        {/* Dimmed rather than hidden while the rainbow is off, so the colours
            it would turn on are visible beforehand. */}
        <View
          style={look.rainbow ? null : styles.dimmed}
          pointerEvents={look.rainbow ? "auto" : "none"}
        >
          <>
            <Toggle
              label={t("look.rainbowRotate")}
              hint={t("look.rotateHint")}
              value={look.rainbowRotate}
              hue={1}
              onChange={(rainbowRotate) =>
                setAppearance({
                  rainbowRotate,
                  // A new offset each time it is switched on.
                  rainbowSeed: rainbowRotate ? (look.rainbowSeed + 1) % 8 : 0,
                })
              }
            />

            <View style={styles.axisRow}>
              <View style={styles.axisName}>
                <Body>{t("look.palette")}</Body>
                <InfoBubble tip={t("look.paletteHint")} />
              </View>
              <View style={styles.swatches}>
                {palette.map((hex, i) => (
                  <EditableSwatch
                    key={`${i}-${hex}`}
                    hex={hex}
                    label={hex.toUpperCase()}
                    // All palette colours are in force, so the ring marks the
                    // swatch a second press would open.
                    selected={armed?.kind === "palette" && armed.index === i}
                    onPress={() => {
                      if (armed?.kind === "palette" && armed.index === i) {
                        setEditing({ kind: "palette", index: i, hex });
                        setArmed(null);
                      } else {
                        setArmed({ kind: "palette", index: i });
                      }
                    }}
                  />
                ))}
              </View>
              <ResetMark
                label={t("look.paletteReset")}
                disabled={palette.join() === RAINBOW.join()}
                onPress={() => setAppearance({ palette: [] })}
              />
            </View>
          </>
        </View>
      </Section>

      {/* Three modes, without the web's pointer-based `reactive`. The bottom
          bar has its own setting, since it fits five words across the width. */}
      <Section title={t("look.labels")} hint={t("look.labelsHint")} hue={3}>
        <AxisLabel>{t("look.labelsEverywhere")}</AxisLabel>
        <Choice<LabelMode>
          // A stored `reactive` shows as symbols, which is how it rendered.
          value={look.labels === "reactive" ? "glyph" : look.labels}
          onChange={(labels) => setAppearance({ labels })}
          options={[
            { value: "text", label: t("look.labelText") },
            { value: "textGlyph", label: t("look.labelTextGlyph") },
            { value: "glyph", label: t("look.labelGlyph") },
          ]}
        />
        <AxisLabel hint={t("look.barLabelsHint")}>{t("look.barLabels")}</AxisLabel>
        <Choice<BarLabelMode>
          // The resolved mode, so a stored "same" still lights a segment; see
          // barMode in ui.tsx.
          value={barLabels}
          onChange={(barLabels) => setAppearance({ barLabels })}
          options={[
            { value: "text", label: t("look.labelText") },
            { value: "textGlyph", label: t("look.labelTextGlyph") },
            { value: "glyph", label: t("look.labelGlyph") },
          ]}
        />
      </Section>

      {/* Android's reduce motion setting still wins; see motion.ts. */}
      <Section title={t("look.motion")} hint={t("look.motionHint")} hue={4}>
        <Choice<MotionIntensity>
          value={look.motion}
          onChange={(motion) => {
            // Animated at the new level, as a preview of it.
            animateNext(motion);
            setAppearance({ motion });
            // Taps on the chosen level count towards the storm; see eggs.tsx.
            storm.tap(motion);
          }}
          options={[
            { value: "off", label: t("look.motionOff") },
            { value: "subtle", label: t("look.motionSubtle") },
            { value: "wild", label: t("look.motionWild") },
            ...(storm.offered ? [{ value: "storm" as MotionIntensity, label: t("look.motionStorm") }] : []),
          ]}
        />
      </Section>

      <Section title={t("look.language")} hue={5}>
        {/* The flag is an emoji, not a glyph, so it is passed as the mark. */}
        <Button
          label={langName(lang)}
          mark={() => <Text style={styles.flag}>{flagEmoji(langFlag(lang))}</Text>}
          onPress={() => nav.navigate("Language")}
        />
      </Section>

      {/* The job defaults and run conditions live on their own page. */}
      <Section title={t("engine.defaults")} hint={t("settings.syncHint")} hue={5}>
        <Button
          label={t("settings.openSync")}
          labelKey="settings.openSync"
          onPress={() => nav.navigate("Sync")}
        />
      </Section>

      {/* Each permission switch reads Android's state; a tap opens the
          request dialog or the settings page, and the switch follows what
          Android reports when the app returns. */}
      <Section
        // On Android 10 the switch cannot move, and the bubble says why.
        title={t("phone.access")}
        hint={possible ? t("phone.permissionHint") : t("phone.accessNone")}
        hue={6}
      >
        <Toggle
          label={t("phone.permissionGranted")}
          off={t("phone.permissionDenied")}
          // Off until the answer arrives.
          value={granted === true}
          disabled={!possible}
          onChange={() => engine.openStorageSettings()}
        />
      </Section>

      <Section title={t("phone.notify")} hint={t("phone.permissionHint")} hue={7}>
        <Toggle
          label={t("phone.permissionGranted")}
          off={t("phone.permissionDenied")}
          value={notify === true}
          onChange={() => {
            // After a refusal Android shows no dialog, so the settings page is
            // the fallback.
            if (notify) engine.openNotificationSettings();
            else askNotifications().then((ok) => (ok ? refresh() : engine.openNotificationSettings()));
          }}
        />
        <Button
          label={t("phone.openNotifications")}
          labelKey="phone.openNotifications"
          onPress={() => engine.openNotificationSettings().catch(() => {})}
        />
      </Section>

      <Section title={t("phone.doze")} hint={t("phone.dozeOff")} hue={0}>
        <Toggle
          label={t("phone.permissionGranted")}
          off={t("phone.permissionDenied")}
          value={doze === true}
          onChange={() => {
            // The dialog shows once; revoking goes through the app's settings.
            if (doze) engine.openAppSettings();
            else engine.askBatteryExemption().catch(() => engine.openAppSettings());
          }}
        />
        {/* Some OEM power managers keep their own setting in this list. */}
        <Button
          label={t("phone.openBattery")}
          labelKey="phone.openBattery"
          onPress={() => engine.openBatterySettings().catch(() => {})}
        />
      </Section>

      {/* One file with a fixed name in Downloads; the path can be edited to
          import a file moved elsewhere. */}
      <Section title={t("settings.backup")} hint={t("settings.backupHint")} hue={2}>
        <Field
          label={t("settings.backupFile")}
          value={backupFile}
          onChange={setBackupFile}
          placeholder="/storage/emulated/0/Download"
        />
        <View style={styles.actions}>
          <Button
            label={t("settings.export")}
            labelKey="settings.export"
            tone="accent"
            busy={backupBusy}
            onPress={exportSettings}
          />
          <Button
            label={t("settings.import")}
            labelKey="settings.import"
            busy={backupBusy}
            onPress={importSettings}
          />
        </View>
        {backupSaid ? <Body>{backupSaid}</Body> : null}
      </Section>

      {/* The phone's own lock rather than an app PIN, so there is no second
          secret to forget. */}
      <Section
        title={t("settings.lock")}
        hint={lockable ? t("settings.lockHint") : t("settings.lockUnavailable")}
        hue={3}
      >
        <Toggle
          label={t("settings.lockOn")}
          value={look.lock}
          disabled={!lockable}
          onChange={(on) => {
            // The lock is tried before it is switched on, so it cannot lock
            // somebody out.
            if (!on) {
              setAppearance({ lock: false });
              return;
            }
            engine
              .confirmDeviceLock(t("settings.lock"), t("settings.lockHint"))
              .then((ok) => ok && setAppearance({ lock: true }))
              .catch(() => {});
          }}
        />
      </Section>

      <Section title={t("engine.title")} hint={t("phone.engineHint")} hue={1}>
        <Body>{running ? t("phone.engineOn") : t("phone.engineOff")}</Body>
        <View style={styles.actions}>
          {running ? (
            <Button
              label={t("phone.engineStop")}
              labelKey="phone.engineStop"
              onPress={() => engine.stop().then(refresh)}
            />
          ) : (
            <Button
              label={t("phone.engineStart")}
              labelKey="phone.engineStart"
              tone="accent"
              onPress={() => engine.start().then(refresh)}
            />
          )}
        </View>
      </Section>

      {/* GlimStone's About card: who made it, the donation buttons, the report
          buttons, and the versions as a footer. The links come from
          lib/donate.ts, shared with the web app. The title counts the taps for
          the loop egg, being the only part of the card with no other action. */}
      <Section title={t("about.title")} hue={2} onTitlePress={loop.tap}>
        {loop.mark}
        <Body>{t("about.body")}</Body>

        <Body>{t("about.coffee")}</Body>
        <View style={styles.actions}>
          {/* Brand marks are passed explicitly, never matched from the label key. */}
          <Button
            label={t("about.coffeeButton")}
            labelKey="about.coffeeButton"
            mark={() => <DonateMark name="coffee" scheme={scheme} />}
            onPress={() => Linking.openURL(COFFEE)}
          />
          <Button
            label={t("about.paypal")}
            labelKey="about.paypal"
            mark={() => <DonateMark name="paypal" scheme={scheme} />}
            onPress={() => Linking.openURL(PAYPAL)}
          />
          <Button
            label={t("about.crypto")}
            labelKey="about.crypto"
            mark={() => <DonateMark name="bitcoin" scheme={scheme} />}
            onPress={() => setCrypto(true)}
          />
        </View>

        {/* Extra space above the sentence, so the buttons above pair with
            their own sentence rather than this one. */}
        <View style={styles.breath} />
        <Body>{t("about.report")}</Body>
        <View style={styles.actions}>
          <Button
            label={t("about.repo")}
            labelKey="about.repo"
            mark={() => <DonateMark name="github" scheme={scheme} />}
            onPress={() => Linking.openURL(REPO)}
          />
          {/* Mail reaches the authors rather than a vendor, so its glyph takes
              the accent. */}
          <Button
            label={t("about.mail")}
            labelKey="about.mail"
            mark={() => <Glyph name="IconMail" color={accentInk} />}
            onPress={() =>
              Linking.openURL(
                `mailto:${MAIL}?subject=${encodeURIComponent(
                  `ArrowLoop: ${t("about.mailSubject")}`,
                )}`,
              )
            }
          />
        </View>

        {/* The engine reports its own version; the app manifest's is only the
            fallback when there is no engine to ask. */}
        <Caption>
          <Text onPress={() => Linking.openURL(releaseUrl(version))} style={styles.versionLink}>
            {`ArrowLoop ${version ?? Constants.expoConfig?.version ?? "?"}`}
          </Text>
          {"  ·  "}
          <Text
            onPress={() =>
              Linking.openURL(
                glimstoneRelease(GLIMSTONE_VERSION),
              )
            }
            style={styles.versionLink}
          >
            {`GlimStone ${GLIMSTONE_VERSION}`}
          </Text>
        </Caption>
      </Section>

      {crypto ? <CryptoDonate onClose={() => setCrypto(false)} /> : null}

      {/* One picker for both rows, applying the colour live during the drag. */}
      {editing ? (
        <ColorPicker
          visible
          initial={editing.hex}
          onPick={(hex) => {
            if (editing.kind === "accent") {
              seenAccent.current = hex;
              setAppearance({ accent: hex });
            } else {
              const next = [...palette];
              next[editing.index] = hex;
              setAppearance({ palette: next });
            }
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Page>
  );
}

/** The policy before the bridge has answered: nothing set, nothing held. */
const EMPTY: DevicePolicy = {
  onlyCharging: false,
  onlyWifi: false,
  minBattery: 0,
  notRoaming: false,
  notMetered: false,
  charging: true,
  onWifi: true,
  battery: 100,
  roaming: false,
  metered: false,
  holding: "",
};

// The notification permission goes through React Native's PermissionsAndroid.
// It exists from Android 13; below that notifications are always allowed.
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

/**
 * Returns the release page for a version stamp. The stamp comes from
 * `git describe`, so a build after a tag (`v0.7.0-47-g7b39f19`) has no page of
 * its own and gets the releases list.
 */
function releaseUrl(version: string | null): string {
  if (version && /^v?\d+\.\d+\.\d+$/.test(version)) {
    return `${REPO}/releases/tag/${version.startsWith("v") ? version : `v${version}`}`;
  }
  return `${REPO}/releases`;
}

function langName(code: string): string {
  // Required lazily; LANGUAGES is all this needs from the module.
  const { LANGUAGES } = require("../i18n") as typeof import("../i18n");
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/** The flag's country code for a language, empty for one the app does not list. */
function langFlag(code: string): string {
  const { LANGUAGES } = require("../i18n") as typeof import("../i18n");
  return LANGUAGES.find((l) => l.code === code)?.flag ?? "";
}

const styles = StyleSheet.create({
  // Wraps, or a row of three buttons clips the last one on a narrow phone.
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  axisRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  axisName: { flexDirection: "row", alignItems: "center", gap: space.sm },
  axisRowInner: { flexDirection: "row", alignItems: "center", gap: space.md, flex: 1 },
  dimmed: { opacity: 0.4 },
  versionLink: { fontVariant: ["tabular-nums"] },
  flag: { fontSize: 18 },
  breath: { height: space.sm },
  // Shares the width left after the label equally, so all swatches fit on
  // one line at any width.
  swatches: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, justifyContent: "flex-end" },
});
