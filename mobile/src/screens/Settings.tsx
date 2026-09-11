import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import { api } from "../api";
import { engine, type DevicePolicy } from "../engine";
import { useT } from "../i18n";
import type { Nav, SettingsStack } from "../nav";
import { ACCENTS, RAINBOW, space } from "../theme";
import {
  setAppearance,
  settings as settingsApi,
  useAppearance,
  useEngineSettings,
  type EngineSettings,
  type LabelMode,
  type Shape,
  type ThemeChoice,
} from "../settings";
import { Field } from "../fields";
import { Schedule } from "./JobEdit";
import { AxisLabel, Body, Button, Caption, Choice, Page, Section, Swatch, Title, Toggle } from "../ui";

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
  const [version, setVersion] = useState<string | null>(null);
  const [lockable, setLockable] = useState(false);
  const [backupFile, setBackupFile] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSaid, setBackupSaid] = useState("");

  // The engine's own defaults, read and written through its settings.
  const { settings, update } = useEngineSettings(true);
  const defaults = (settings?.defaults ?? {}) as Record<string, unknown>;
  const saveDefaults = (patch: Record<string, unknown>) =>
    update({ defaults: { ...defaults, ...patch } });

  /**
   * Everything the backup carries, as one object.
   *
   * The engine's settings and the jobs, and deliberately NOT the look or the
   * lock: those describe this install rather than the configuration, and a file
   * carried to a second phone that switched a lock on there would be a surprise
   * nobody asked for.
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
      // Checked before anything is written. A JSON file that parses is not the
      // same as a backup, and restoring an arbitrary object into the engine's
      // settings is how somebody loses the jobs they were trying to keep.
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
      engine.alive(),
      engine.devicePolicy(),
      engine.batteryExempt(),
    ]);
    setGranted(access);
    setPossible(can);
    setRunning(alive);
    setPolicy(device);
    setDoze(exempt);
    engine.hasDeviceLock().then(setLockable, () => setLockable(false));
    // Shown before a backup has ever been written, so the card says where one
    // WOULD go rather than leaving an empty box above two buttons.
    setBackupFile((old) => old || "");
    engine.backupPath().then(
      (where) => setBackupFile((old) => old || where),
      () => {},
    );
    setNotify(await notificationsGranted());
    // Asked rather than assumed, and allowed to fail: a stopped engine is a
    // real state and the card still has to draw.
    api.capabilities().then((c) => setVersion(c.version), () => setVersion(null));
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
      : policy?.onlyWifi && !policy.onWifi
        ? t("phone.heldWifi")
        : "";

  return (
    <Page>
      {/* The look, as one card per axis and each card owning a palette
          position: they are members of one set the way a tab strip's tabs are,
          so with the rainbow on they go plural together. */}
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

      <Section title={t("look.colors")} hue={2}>
        {/* Label left, swatches right, ONE row. The colours used to be a
            wrapping strip of named pills, which is a list of words about
            colours rather than the colours themselves - and it took four lines
            to say what nine circles say at a glance. The row divides whatever
            width it has between nine equal things, so it fits on a narrow
            handset without a smaller fixed size that would only move the wrap
            to a narrower one. */}
        {/* Gone while the rainbow is on, not dimmed. The mode replaces the
            accent for everything that is one member of a set, so an accent
            chosen under it is a colour most of the screen has stopped using -
            and the same rule applies as to the switch below: a row of nine
            circles nobody can press is a question with no answer. */}
        {!look.rainbow ? (
          <View style={styles.axisRow}>
            <Body>{t("look.accent")}</Body>
            <View style={styles.swatches}>
              {ACCENTS.map((a) => (
                <Swatch
                  key={a.hex}
                  hex={a.hex}
                  label={a.name}
                  selected={a.hex.toLowerCase() === look.accent.toLowerCase()}
                  onPress={() => setAppearance({ accent: a.hex })}
                />
              ))}
            </View>
          </View>
        ) : null}
        <Toggle
          label={t("look.rainbowOn")}
          hint={t("look.rainbowHint")}
          value={look.rainbow}
          hue={0}
          onChange={(rainbow) => setAppearance({ rainbow })}
        />
        {/* Only while the rainbow is running. jdp: "dieser abgeschaltet toggle
            soll weg, das hab ich schon oft angesprochen." It was dimmed rather
            than absent, which is a switch somebody can see, read and reach for
            and that answers nothing - and the reason it is dead lives one row
            up, where nobody looks after deciding this row is the interesting
            one. A control that cannot be used is not information, it is a
            question with no answer. */}
        {look.rainbow ? (
          <Toggle
            label={t("look.rainbowReactive")}
            hint={t("look.reactiveHint")}
            value={look.rainbowReactive}
            hue={1}
            onChange={(rainbowReactive) => setAppearance({ rainbowReactive })}
          />
        ) : null}
        {/* The palette in force, shown rather than described: eight colours say
            what "rainbow" means faster than any sentence about it. It used to
            be drawn dimmed while the mode was off, which put two greyed rows of
            circles in one card. Now the card carries exactly ONE row of colours
            at a time - the accent while the rainbow is off, the palette while
            it is on - and neither of them is ever grey. */}
        {look.rainbow ? (
          <View style={styles.swatches} pointerEvents="none">
            {RAINBOW.map((hex, i) => (
              <Swatch key={`${hex}-${i}`} hex={hex} label={hex} selected={false} onPress={() => {}} />
            ))}
          </View>
        ) : null}
      </Section>

      <Section title={t("look.labels")} hint={t("look.labelsHint")} hue={3}>
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

      <Section title={t("look.language")} hue={4}>
        <Button label={langName(lang)} onPress={() => nav.navigate("Language")} />
      </Section>

      {/* What a new job starts from. The engine has carried defaults for a
          while and they were only reachable by editing the file: a job that
          says nothing about a setting takes the default, and a job that says
          something keeps its own answer. Setting the pair here once is the
          difference between "everything on this phone goes up and the space
          comes back" being one decision or one per job. */}
      <Section title={t("engine.defaults")} hint={t("defaults.followHint")} hue={4}>
        <AxisLabel>{t("direction.label")}</AxisLabel>
        <Choice
          value={String(defaults.direction ?? "both")}
          onChange={(direction) =>
            saveDefaults({ direction, mode: direction === "both" ? "sync" : defaults.mode })
          }
          options={[
            { value: "both", label: t("direction.both") },
            { value: "leftToRight", label: t("direction.toRight") },
            { value: "rightToLeft", label: t("direction.toLeft") },
          ]}
        />
        {/* Both ways has no choice to make here, and the selector says so by
            going inert with `sync` still showing rather than vanishing. A
            paragraph used to stand in its place, which left the card two
            different shapes depending on the answer above it - and the reason
            belongs in the (i) like every other reason in this app. */}
        {(() => {
          const both = (defaults.direction ?? "both") === "both";
          return (
            <>
              <AxisLabel hint={both ? t("mode.onlyOneWay") : undefined}>{t("mode.label")}</AxisLabel>
              <Choice
                disabled={both}
                value={both ? "sync" : String(defaults.mode ?? "sync")}
                onChange={(mode) => saveDefaults({ mode })}
                options={[
                  { value: "sync", label: t("mode.sync") },
                  { value: "mirror", label: t("mode.mirror") },
                  { value: "move", label: t("mode.move") },
                ]}
              />
            </>
          );
        })()}
        {/* The schedule belongs with the pair above it, not on its own: "every
            night at three" is a decision about a PHONE far more often than
            about one folder, which is why the engine has carried it as a
            default all along. It was reachable only by editing the file. */}
        <AxisLabel>{t("edit.schedule")}</AxisLabel>
        <Schedule
          value={String(defaults.schedule ?? "")}
          onChange={(schedule) => saveDefaults({ schedule })}
        />
      </Section>

      {/* How much at once, and how long to wait for a folder to settle. Its own
          card because Autosync groups the same two that way and the reason
          holds: these answer "how hard does it push", where the card above
          answers "what does it do". */}
      <Section title={t("settings.transfer")} hue={5}>
        <Field
          label={t("engine.transfers")}
          hint={t("engine.transfersHint")}
          keyboard="numeric"
          value={String(defaults.transfers ?? 4)}
          onChange={(v) => saveDefaults({ transfers: Number(v) || undefined })}
        />
        <Field
          label={t("edit.quietPeriod")}
          hint={t("edit.quietHint")}
          value={String(defaults.quietPeriod ?? "")}
          onChange={(quietPeriod) => saveDefaults({ quietPeriod })}
          placeholder="30s"
        />
      </Section>

      {/* What travels besides the file contents. Two switches that change what
          arrives at the other end rather than how fast. */}
      <Section title={t("settings.contents")} hue={6}>
        <Toggle
          label={t("edit.emptyDirs")}
          hint={t("edit.emptyDirsHint")}
          value={Boolean(defaults.emptyDirs)}
          onChange={(emptyDirs) => saveDefaults({ emptyDirs })}
        />
        <Toggle
          label={t("edit.metadata")}
          hint={t("edit.metadataHint")}
          value={Boolean(defaults.metadata)}
          onChange={(metadata) => saveDefaults({ metadata })}
        />
      </Section>

      {/* The brakes, and they get a card of their own because of what they are:
          the net that stops a run removing more than half of everything it
          knows about. Until now they were invisible on the phone entirely. */}
      <Section title={t("settings.safetyNet")} hue={7}>
        <Field
          label={t("engine.brakePercent")}
          hint={t("engine.brakePercentHint")}
          keyboard="numeric"
          value={String(defaults.brakePercent ?? 50)}
          onChange={(v) => saveDefaults({ brakePercent: clamp(v, 0, 100) })}
        />
        <Field
          label={t("engine.brakeFloor")}
          hint={t("engine.brakeFloorHint")}
          keyboard="numeric"
          value={String(defaults.brakeFloor ?? 10)}
          onChange={(v) => saveDefaults({ brakeFloor: clamp(v, 0, 100000) })}
        />
      </Section>

      {/* Autosync's own name for this group, and it is the better one: the two
          switches are not about WHEN a job is due, they are about whether the
          phone lets a due job go ahead. */}
      <Section title={t("phone.schedule")} hue={0}>
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

      {/* The two permissions, each as a switch that SHOWS whether it is on.
          jdp: "dateizugriff und benachrichtigungen card sollen jeweils ein
          toggle zeigen ob es aktiviert ist oder nicht." A card that said
          "granted" in one state and offered a button in the other made you read
          a sentence to learn a yes or a no, and the two cards did not even look
          alike from one state to the next.

          Android owns these switches, not this app: nothing here can grant or
          revoke a permission, only ask. So a tap goes where the answer is
          actually given - the request dialog while there is one to show, the
          system settings page otherwise - and the switch follows what Android
          says when the screen comes back. It is a READING of the permission
          with a way to change it, which is the honest version of a control
          somebody else owns, and the bubble says so. */}
      <Section
        // Why the switch is dead, said in the same bubble rather than as a
        // paragraph beneath it: an Android old enough to lack this permission
        // leaves a control nobody can move, and a control nobody can move needs
        // its reason where every other reason lives.
        title={t("phone.access")}
        hint={possible ? t("phone.permissionHint") : t("phone.accessNone")}
        hue={6}
      >
        <Toggle
          // The card's notch already carries the permission's NAME, so the row
          // says what the switch answers instead of saying the name twice.
          label={t("phone.permissionGranted")}
          // `null` while the answer is still being fetched, which is a moment
          // long enough to see. Off is the right guess for an unknown
          // permission: it is what Android says until somebody says otherwise.
          value={granted === true}
          disabled={!possible}
          onChange={() => engine.openStorageSettings()}
        />
      </Section>

      <Section title={t("phone.notify")} hint={t("phone.permissionHint")} hue={7}>
        <Toggle
          label={t("phone.permissionGranted")}
          value={notify === true}
          onChange={() => {
            // Asking works once: after a refusal Android answers immediately
            // without showing anything, and then the settings page is the only
            // place left where the answer can change.
            if (notify) engine.openNotificationSettings();
            else askNotifications().then((ok) => (ok ? refresh() : engine.openNotificationSettings()));
          }}
        />
        {/* Straight into Android's own page, which is where every question
            about a notification is actually answered: sound, vibration,
            banners, Do Not Disturb, the per-channel switches. jdp: "die
            einstellungen für die benachrichtigungen sollen wir in die nativen
            Android Benachrichtigungseinstellungen der app verlinken wie in
            Autosync." Rebuilding that here would be a second set of switches
            over the same state, and the phone's own is the one that applies. */}
        <Button
          label={t("phone.openNotifications")}
          labelKey="phone.openNotifications"
          onPress={() => engine.openNotificationSettings().catch(() => {})}
        />
      </Section>

      {/* The third permission, and the same shape as the two above it. It was
          not in the request, and leaving it as prose-and-a-button would have
          made one card out of three look like a different app. */}
      <Section title={t("phone.doze")} hint={t("phone.dozeOff")} hue={0}>
        <Toggle
          label={t("phone.permissionGranted")}
          value={doze === true}
          onChange={() => {
            // Android shows this one as a real dialog, once. Afterwards, and to
            // take it back, the app's own settings page is where it lives.
            if (doze) engine.openAppSettings();
            else engine.askBatteryExemption().catch(() => engine.openAppSettings());
          }}
        />
        {/* The LIST, beside the dialog above, and both are needed. The dialog
            is one button and is enough on a stock Android; this is where an
            OEM's own power manager keeps the setting that actually decides
            whether a background job ever runs. jdp: "zudem brauchen wir in den
            einstellungen noch eine verlinkung zu den energiesparmodus damit man
            die app da ausnehmen kann." */}
        <Button
          label={t("phone.openBattery")}
          labelKey="phone.openBattery"
          onPress={() => engine.openBatterySettings().catch(() => {})}
        />
      </Section>

      {/* Carrying the whole setup off this phone and back onto it.

          It writes ONE file with a fixed name into Downloads, rather than
          opening a picker: a backup nobody can find again is not a backup, and
          a picker puts it somewhere different every time. The path is shown
          and can be edited on the way back in, so a file moved elsewhere is
          still reachable.

          What travels: the engine's settings and the jobs. NOT the look and not
          the lock - those are properties of this install rather than of the
          configuration, and a backup carried to a second phone that switched a
          lock on there would be a surprise nobody asked for. */}
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

      {/* The phone's OWN lock rather than an app PIN, which is what jdp asked
          for ("die möglichkeit die app zu sperren (gerätesperre)") and is the
          better of the two anyway: a second secret is a second thing to forget,
          and an app that offers one has to answer "what if I forget it" with
          "wipe the app data". The system dialog already offers a fingerprint
          where one is enrolled, so this is not a choice between the two. */}
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
            // Asked for BEFORE it goes on, not after. A switch that locks the
            // app and then discovers the lock does not answer is a switch that
            // locked somebody out, and the one moment to find that out is while
            // they are still looking at the settings.
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

      <Section title={t("settings.about")} hue={2}>
        {/* The ENGINE's version, not the app manifest's. They are two numbers
            for one program and only one of them is stamped by the build: the
            manifest's was typed once and sat at 0.1.0 while the engine beside
            it reported v0.7.0, so the one card whose whole job is saying what
            you are looking at was saying the wrong thing. The manifest number
            is the fallback for a build with no engine to ask. */}
        <Title>{`ArrowLoop ${version ?? Constants.expoConfig?.version ?? "?"}`}</Title>
        <Caption>{t("about.body")}</Caption>
        <View style={styles.actions}>
          <Button
            label={t("about.repo")}
            labelKey="about.repo"
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
  onWifi: true,
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

/**
 * A typed number, held inside the range the engine accepts.
 *
 * An empty box gives `undefined` rather than zero, which is the difference
 * between "unset, take the built-in" and "zero per cent", and on a brake that
 * difference is a run that stops at half against one that stops at nothing.
 */
function clamp(text: string, low: number, high: number): number | undefined {
  const value = Number(text.replace(/[^\d]/g, ""));
  if (!text.trim() || Number.isNaN(value)) return undefined;
  return Math.min(high, Math.max(low, value));
}

function langName(code: string): string {
  // Imported lazily rather than at the top, because LANGUAGES is the only
  // thing this needs from a module that carries forty tables behind it.
  const { LANGUAGES } = require("../i18n") as typeof import("../i18n");
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.sm },
  axisRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  // `flex: 1` with the swatches' own maxWidth: the row takes what is left
  // after the label and divides it equally, which is what keeps nine circles
  // on one line at every handset width.
  swatches: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, justifyContent: "flex-end" },
});
