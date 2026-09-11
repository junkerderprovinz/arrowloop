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
  // For the About card's marks: the brands carry a per-theme colour of their
  // own, and the one house button takes the accent rather than a vendor's.
  const { scheme, accentInk } = useTheme();
  // The intensity in force, for the handfuls of places that animate a change.
  const { intensity: motion } = useMotion();

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

  /**
   * Which circle the picker is open on, or nothing.
   *
   * One piece of state for both rows, because only one picker can be open: the
   * `kind` says which row to write back to, and the index says which slot.
   */
  const [editing, setEditing] = useState<{ kind: "accent" | "palette"; index: number; hex: string } | null>(
    null,
  );

  /**
   * Which preset slot owns the live accent, REMEMBERED rather than recomputed.
   *
   * Working it out from the colour itself on every render is fine until the
   * picker nudges a colour far enough to be nearer a DIFFERENT preset - and
   * then the live value silently moves to another circle while somebody is
   * still dragging in the picker that opened on the first one. Nearest is still
   * how an unknown colour finds its home, but only when the value arrives from
   * OUTSIDE: a reset, a reload, a restored backup.
   */
  const [accentSlot, setAccentSlot] = useState(() => nearestPreset(ACCENTS.map((a) => a.hex), look.accent));
  const seenAccent = useRef(look.accent);
  useEffect(() => {
    if (seenAccent.current !== look.accent) {
      seenAccent.current = look.accent;
      setAccentSlot(nearestPreset(ACCENTS.map((a) => a.hex), look.accent));
    }
  }, [look.accent]);

  /** The palette in force: what was edited, or what the app ships with. */
  const palette = look.palette.length ? look.palette : RAINBOW;

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
      // Whether it ANSWERS, not whether this app's handle to it is alive: the
      // handle stays null when the engine was already up at launch, and the
      // card then said "stopped" while the screen above it was reading the
      // configuration over HTTP.
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

  const setConditions = async (next: Partial<DeviceConditions>) => {
    setPolicy((old) => ({ ...(old ?? EMPTY), ...next }));
    await engine.setDevicePolicy(next);
    refresh();
  };

  // Which condition is holding things up, said in the app's own words rather
  // than the engine's. The engine is told a sentence for its log; a screen that
  // repeated that sentence would be showing English to somebody reading German.
  //
  // The decision moved into deviceConditions.ts when there were five conditions
  // instead of two: this page and the sync page each had their own answer, and
  // the other one was simply printing the engine's English.
  const heldAt = heldKey(policy);
  const held = heldAt ? t(heldAt) : "";

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

      {/* The colours, built the way the container builds them: every circle is
          a control that both CHOOSES and EDITS.

          It used to be eight presets and nothing else, with the rainbow palette
          drawn `pointerEvents="none"` - eight circles that looked like controls
          and answered nothing at all. jdp: "die farbfelder sollen bearbeitbar
          sein." A row of colours nobody can change is a row of colours somebody
          will press anyway.

          ONE PRESS does both, which is deliberate rather than clever. Reserving
          the picker for a SECOND press on the already-chosen circle is
          defensible in isolation and was reported on the container as "kein
          Farbpicker": a control nobody can find is a control that is not there.

          The reactive switch is gone entirely. It meant "colour where the eye
          is", which on a screen with no pointer is nowhere. jdp: "den reaktiv
          toggle können wir in der app weglassen. man hoovert ja nicht mit der
          maus." */}
      <Section title={t("look.colors")} hue={2}>
        {/* DIMMED while the rainbow is on, not gone - which is the container's
            treatment and the right one here (jdp: "die akzentfarben farbfelder
            sollen nicht ausgeblendet werden wenn man den regenbogenmodus
            aktiviert, nur abgedunkelt und deaktiviert wie im container").

            It looks like the opposite of the rule that took the reactive switch
            away, and it is the rule's own exception: a control greyed because
            it is REPORTING stays. This row reports which accent is set, and
            that fact does not stop being true because another mode is painting
            over it - somebody who turns the rainbow back off wants to see what
            they are returning to. A greyed SWITCH is a question with no answer;
            a greyed READING is an answer. */}
        <View style={[styles.axisRow, look.rainbow ? styles.dimmed : null]} pointerEvents={look.rainbow ? "none" : "auto"}>
          <View style={styles.axisRowInner}>
            <Body>{t("look.accent")}</Body>
            <View style={styles.swatches}>
              {ACCENTS.map((a, i) => {
                // The slot holding the LIVE colour shows it rather than its own
                // preset. Once the picker can nudge a preset into something
                // that is no longer a preset, showing the preset would leave
                // the colour applied everywhere and drawn nowhere: no circle
                // would match it, none would be marked, and there would be no
                // way back into the picker that made it.
                const mine = i === accentSlot;
                const hex = mine ? look.accent : a.hex;
                return (
                  <EditableSwatch
                    key={a.hex}
                    hex={hex}
                    // A preset's NAME on a circle that is no longer that preset
                    // is the one label worse than none, so an edited slot names
                    // its own hex instead.
                    label={mine && hex.toLowerCase() !== a.hex.toLowerCase() ? hex.toUpperCase() : a.name}
                    selected={mine}
                    onPress={() => {
                      setAccentSlot(i);
                      setAppearance({ accent: hex });
                      setEditing({ kind: "accent", index: i, hex });
                    }}
                  />
                );
              })}
            </View>
            {/* THE RESET AT THE END of the row it resets, which is where the
                container puts it (jdp: "der reset button der farbfelder soll
                ganz nach rechts, wie im container"). It reads as the last thing
                in the row rather than as a label for it: a mark before eight
                circles looks like it introduces them, and a mark after them
                looks like what it is - the way back out. */}
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
            // The palette row and the rotate switch appear and disappear with
            // this, which is exactly what a layout animation is for: without
            // one the card jumps by two rows.
            animateNext(motion);
            setAppearance({ rainbow });
          }}
        />

        {/* Both of these hang off the mode itself, so they are ABSENT while it
            is off rather than dimmed: an instruction to a rainbow that is not
            running is a control somebody can see, read and reach for that
            answers nothing, and the reason it is dead sits one row up where
            nobody looks after deciding this row is the interesting one. */}
        {look.rainbow ? (
          <>
            <Toggle
              label={t("look.rainbowRotate")}
              hint={t("look.rotateHint")}
              value={look.rainbowRotate}
              hue={1}
              onChange={(rainbowRotate) =>
                setAppearance({
                  rainbowRotate,
                  // A new offset on every switch-on, so turning it on twice is
                  // two different pages rather than the same one.
                  rainbowSeed: rainbowRotate ? (look.rainbowSeed + 1) % 8 : 0,
                })
              }
            />

            {/* The palette in force, shown rather than described: eight colours
                say what "rainbow" means faster than any sentence about it, and
                each of them opens on a press. There is no "the selected one"
                here - every colour is in force at once - so a press can only
                mean edit, which is the one way this row differs from the accent
                row above it. */}
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
                    selected={false}
                    onPress={() => setEditing({ kind: "palette", index: i, hex })}
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
        ) : null}
      </Section>

      {/* Three modes, not the web's four. `reactive` means "the words appear
          under the pointer", and a phone has no pointer - offered here it is a
          setting that takes every label away and gives nothing back, because
          the gesture that brings them back does not exist. jdp: "auch hier gibt
          es keinen reaktiven modus in der app, das macht kein sinn." */}
      <Section title={t("look.labels")} hint={t("look.labelsHint")} hue={3}>
        <Choice<LabelMode>
          // A build that stored `reactive` before this change would otherwise
          // land on a well with nothing lit, which reads as broken rather than
          // as migrated. Symbols is what reactive already looked like here.
          value={look.labels === "reactive" ? "glyph" : look.labels}
          onChange={(labels) => setAppearance({ labels })}
          options={[
            { value: "text", label: t("look.labelText") },
            { value: "textGlyph", label: t("look.labelTextGlyph") },
            { value: "glyph", label: t("look.labelGlyph") },
          ]}
        />
      </Section>

      {/* THE MOTION ENGINE, which this app had none of: no animation anywhere,
          and no setting to dial one down. The container has had all three
          intensities for months, and GlimStone treats motion as one of the
          axes a person owns - like the theme and the corners - rather than as
          something an app decides for them.

          It composes with Android's own reduced-motion setting and never
          overrides it: somebody who turned animations off system-wide did not
          mean "except in this one app", so the system's answer wins and this
          picker then only says what WOULD happen. See motion.ts. */}
      <Section title={t("look.motion")} hue={4}>
        <Choice<MotionIntensity>
          value={look.motion}
          onChange={(motion) => {
            // The change animates ITSELF at the new intensity, which is the
            // only honest preview: picking "subtle" and watching the next
            // thing move subtly is the setting demonstrating itself.
            animateNext(motion);
            setAppearance({ motion });
          }}
          options={[
            { value: "off", label: t("look.motionOff") },
            { value: "subtle", label: t("look.motionSubtle") },
            { value: "full", label: t("look.motionFull") },
          ]}
        />
      </Section>

      <Section title={t("look.language")} hue={5}>
        {/* THE FLAG ON THE CARD, not only inside the list. The card is where
            somebody checks which language is running, and a row of words with
            no mark on it is the one row on this page carrying no symbol at all.
            jdp: "in der card wird die flagge nicht angezeigt."

            Passed as an explicit mark rather than resolved from the label key,
            because a flag is not in the glyph set: it is an emoji the phone
            draws, and the rule table has no entry that could produce one. */}
        <Button
          label={langName(lang)}
          mark={() => <Text style={styles.flag}>{flagEmoji(langFlag(lang))}</Text>}
          onPress={() => nav.navigate("Language")}
        />
      </Section>

      {/* ONE ENTRY where five cards used to be. What a job does, how hard it
          pushes, what travels, the brakes and when the phone lets a due job go
          ahead all live behind this now: five cards answering one question,
          sitting among the accent colour and the three permissions, made a page
          of fifteen where somebody scrolling for the language passed all of
          them. jdp: "die globalen synceinstellungen sind mir zu wenig… auch
          bestehende einstellungen die jetzt separat sind darin aufnehmen."

          A page somebody CHOOSES to open can be as long as it needs to be. */}
      {/* Its OWN hint, not the one the switch inside a job wears. That one
          says "take this from the settings instead of deciding it here", which
          on the settings page points at the page somebody is already standing
          on (jdp: "der infotext der globalen synceinstellungen ist
          unverständlich formuliert"). It was never written for this place. */}
      <Section title={t("engine.defaults")} hint={t("settings.syncHint")} hue={5}>
        <Button
          label={t("settings.openSync")}
          labelKey="settings.openSync"
          onPress={() => nav.navigate("Sync")}
        />
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
          off={t("phone.permissionDenied")}
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
          off={t("phone.permissionDenied")}
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
          off={t("phone.permissionDenied")}
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

      {/* The About card in the shape the design language sets out, which this
          one was not. jdp: "Die über card ist nicht auf dem aktuellen stand und
          im GSS." It carried one sentence, one button, and the version in its
          TITLE - so the number was a dead end, there was no way to say thank
          you and no way to report anything.

          The ORDER is the standard, not the markup: a sentence about who made
          it, a sentence about the money with its buttons directly under it, a
          sentence inviting a report with its buttons under that, and the
          versions LAST as a footer. Each sentence sits above the thing it asks
          for - three sentences stacked over one row of buttons reads as a form
          to work through.

          Three ways to give, side by side, because they reach three different
          people: a card through Buy Me a Coffee, a PayPal balance, and what
          somebody already holds in a wallet - the last one needs no account and
          no name at either end, and works in a country where the other two do
          not. The same three the container offers, from the same two constants
          in lib/donate.ts, so neither card can quietly point somewhere else. */}
      <Section title={t("about.title")} hue={2}>
        <Caption>{t("about.body")}</Caption>

        <Caption>{t("about.coffee")}</Caption>
        <View style={styles.actions}>
          {/* Each mark is passed here rather than resolved from the label key,
              which is the design language's rule for a BRAND. A pattern keyed
              on "coffee" would put a company's cup on anything that mentions
              coffee, and one on "crypto" would put the Bitcoin symbol on
              settings that have nothing to do with it.

              ORDER: the two hosted payment pages first and the wallet last
              (jdp, 2026-09-11). It reads as a ramp rather than an alphabet -
              the two routes most people already have an account for, then the
              one that needs none. */}
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

        {/* An extra step of space above this sentence, which is GlimStone's
            general rule for a card that runs sentence, controls, sentence,
            controls: at even spacing the crypto button sits as close to THIS
            sentence as to the one it belongs to, so the eye pairs it with the
            wrong text and the card reads as one column rather than two offers.
            The step goes above the SENTENCE and never below the controls - a
            card ending in a gap reads as a missing row. */}
        <View style={styles.breath} />
        <Caption>{t("about.report")}</Caption>
        <View style={styles.actions}>
          {/* GitHub's own mark, passed like the three above. It wore the rule
              table's chain link before, which is a LINK glyph: right for a URL
              and wrong for a forge, and it would follow this project to a
              different one and be wrong there too. */}
          <Button
            label={t("about.repo")}
            labelKey="about.repo"
            mark={() => <DonateMark name="github" scheme={scheme} />}
            onPress={() => Linking.openURL(REPO)}
          />
          {/* The one button on this card that is NOT a brand, and the exception
              proves the rule: it reaches this app's own authors rather than a
              third party, so it takes the accent and follows the user's accent
              and rainbow - which a vendor's mark may never do. Its envelope
              comes from the rule table like every other app glyph; only the ink
              is named here. */}
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

        {/* The versions last, one line, muted, and the NUMBER is the link
            rather than the word in front of it. Read from the build on both
            halves: the engine stamps its own, and the design-language number
            travels with the files it describes. The app manifest's number is
            the fallback for a build with no engine to ask - it was the primary
            once, and it sat at 0.1.0 while the engine beside it reported
            v0.7.0. */}
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

      {/* One picker for both rows. It writes on every frame of the drag, so the
          page behind it changes while the finger is still down - which is the
          whole point of picking a colour for an interface rather than for a
          swatch book. */}
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

/** What to merge into before the phone has answered. Every switch off and
 *  every fact benign, so a screen that paints before the bridge replies shows
 *  nothing held rather than a condition nobody set. */
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
 * The release page for a version stamp, or the releases list when there is none.
 *
 * The stamp is `git describe`, so a build ON a tag reads `v0.7.0` and one after
 * it reads `v0.7.0-47-g7b39f19`. Only the first is a page that exists; the rest
 * go to the list, which is the honest destination for "somewhere after 0.7.0"
 * and beats a 404 with a tag name in it.
 */
function releaseUrl(version: string | null): string {
  if (version && /^v?\d+\.\d+\.\d+$/.test(version)) {
    return `${REPO}/releases/tag/${version.startsWith("v") ? version : `v${version}`}`;
  }
  return `${REPO}/releases`;
}

function langName(code: string): string {
  // Imported lazily rather than at the top, because LANGUAGES is the only
  // thing this needs from a module that carries forty tables behind it.
  const { LANGUAGES } = require("../i18n") as typeof import("../i18n");
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}


/** The country whose flag stands for a language. Empty for one this app does
 *  not list, which `flagEmoji` answers with nothing rather than two boxes. */
function langFlag(code: string): string {
  const { LANGUAGES } = require("../i18n") as typeof import("../i18n");
  return LANGUAGES.find((l) => l.code === code)?.flag ?? "";
}

const styles = StyleSheet.create({
  // Wrapping, because the About card's give row is three buttons wide now and
  // three did not fit: PayPal hung over the right edge of the card with half
  // its label off-screen, found on the phone rather than in a build. A row that
  // cannot wrap silently clips its last member, so the member it loses is
  // always whichever one was added most recently - the one nobody has looked at
  // yet. Every button already grows, so a wrapped line fills itself.
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  axisRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  // The row's NAME and the controls that belong to it: the label, its (i) where
  // it has one, and the reset that undoes this row rather than the card. They
  // travel together so the reset cannot drift to the card's corner, where it
  // would read as undoing everything.
  axisName: { flexDirection: "row", alignItems: "center", gap: space.sm },
  // The row keeps its shape while dimmed, so turning the rainbow on and off
  // does not make the card jump.
  axisRowInner: { flexDirection: "row", alignItems: "center", gap: space.md, flex: 1 },
  dimmed: { opacity: 0.4 },
  // Tabular figures, so two version numbers under each other do not shift, and
  // the accent ink so a number reads as the destination it is.
  versionLink: { fontVariant: ["tabular-nums"] },
  flag: { fontSize: 18 },
  // One step, the same 8 every gap in this house is built from.
  breath: { height: space.sm },
  // `flex: 1` with the swatches' own maxWidth: the row takes what is left
  // after the label and divides it equally, which is what keeps nine circles
  // on one line at every handset width.
  swatches: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, justifyContent: "flex-end" },
});
