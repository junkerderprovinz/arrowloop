import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  AppState,
  Keyboard,
  Linking,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { api } from "../api";
import { AutoBackupSection } from "../autoBackup";
import { IntegrationsSection } from "../vpnSection";
import {
  engine,
  type AppData,
  type AppDataState,
  type AppDataWay,
  type PickedFile,
  type RootTargetState,
  type SharedFolder,
} from "../engine";
import { useT, type T } from "../i18n";
import type { Nav, SettingsStack } from "../nav";
import { FrameProvider, useFrame } from "../frame";
import { Glyph } from "../glyphs";
import { pageTop } from "../layout";
import { SECTION_TILE, paneWidth, settingsTiles, shownTile, TILE_COLUMN, type SectionId, type SettingsTile, type TileId } from "../settingsTiles";
import { Pairing } from "./Pairing";
import { SyncSettings } from "./SyncSettings";
import { Targets } from "./Targets";
import { ACCENTS, BRAND, contrastOn, DEFAULT_ACCENT, PLATFORM, RAINBOW, space, SYSTEM_ACCENT, text, TILE, TOUCH } from "../theme";
import {
  setAppearance,
  settings as settingsApi,
  useAppearance,
  type BarLabelMode,
  type EngineSettings,
  type JobView,
  type LabelMode,
  type Shape,
  type ThemeChoice,
} from "../settings";
import { GLIMSTONE_VERSION } from "../glimstone/version";
import { COFFEE, DISCORD, PAYPAL, RCLONE_REPO, REPO } from "../../../web/src/lib/donate";
import { componentText } from "@glimstone/core/componentTexts";
import { ComponentsSection, VersionSection } from "../infoCards";
import { updatesFrom } from "../store";
import { MANUAL, PRIVACY } from "../../../web/src/lib/handbook";
import { nearestPreset } from "../../../web/src/lib/colorMath";
import { stopEvery } from "../../../web/src/lib/stopEvery";
import { flagEmoji } from "../../../web/src/lib/flagEmoji";
import { describeValue, inForce, type Defaults } from "../../../web/src/lib/follows";
import { oledRefusal } from "../../../web/src/lib/theme";
import { errorText } from "../../../web/src/lib/errorText";
import { importSections } from "../../../web/src/lib/importPlan";
import { useClosingLoop, useDiscoUnlock, useLeafUnlock, useStormUnlock } from "../eggs";
import { animateNext, useMotion, useSystemReduced, type MotionIntensity } from "../motion";
import { ColorPicker, EditableSwatch, ResetMark } from "../ColorPicker";
import { CryptoDonate } from "../donate";
import { Field } from "../fields";
import { FolderPicker } from "../FolderPicker";
import { DropButton } from "../choiceRow";
import { wayLabel, wayOf } from "../way";
import { useWaiting } from "../waiting";
import { useSystemAccent } from "../systemAccent";
import { AppMark, BrandMark, CoffeeArt, DonateMark, ManualMark } from "../glyphs";
import { APPLE_SVG, DOCKER_SVG, FLATPAK_SVG, LINUX_SVG, UNRAID_SVG, WINDOWS_SVG, ZIP_SVG } from "../../../web/src/lib/appMarks";
import { DOCKER_RUN, DOWNLOADS, UNRAID_CA, sourceZip } from "../../../web/src/lib/downloads";
import {
  AxisLabel,
  Body,
  Button,
  Caption,
  Choice,
  Page,
  InfoBubble,
  Pair,
  Press,
  README_GAP,
  ReadmeButton,
  ReadmeRow,
  Row,
  Section,
  Toggle,
  useTheme,
} from "../ui";

/**
 * The settings page, in the order every GlimStone phone app keeps: the
 * language, the phone's own permissions, the look, motion, then what this app
 * does, the other forms of ArrowLoop, the report, About and the danger zone.
 * The global sync settings stand right under the language, since they are
 * what most people come here to change. Each card keeps its palette position
 * wherever it stands.
 */
export function Settings() {
  const nav = useNavigation<Nav<SettingsStack>>();
  const { t, lang } = useT();
  const frame = useFrame();
  const [picked, setPicked] = useState<TileId | null>(null);
  const look = useAppearance();
  const { p, corners, scheme, accent, accentInk, barLabels } = useTheme();
  const { intensity: motion } = useMotion();
  const reduced = useSystemReduced();
  const waiting = useWaiting();
  const storm = useStormUnlock();
  const leaf = useLeafUnlock();
  const disco = useDiscoUnlock();
  const loop = useClosingLoop();

  const windowsMark = (lit: boolean, ink: string) => (
    <AppMark svg={WINDOWS_SVG} ink={lit ? ink : PLATFORM[scheme].windows} />
  );
  // Tux's beak and feet sit on the mark, so on the lit tile they take the
  // tile's own yellow and read as holes.
  const linuxMark = (lit: boolean, ink: string) => (
    <AppMark svg={LINUX_SVG} ink={lit ? ink : p.text} cut={lit ? TILE.linux.color : undefined} />
  );
  const appleMark = (lit: boolean, ink: string) => <AppMark svg={APPLE_SVG} ink={lit ? ink : p.text} />;
  const flatpakMark = (lit: boolean, ink: string) => (
    <AppMark svg={FLATPAK_SVG} ink={lit ? ink : PLATFORM[scheme].flatpak} />
  );

  const [granted, setGranted] = useState<boolean | null>(null);
  const [possible, setPossible] = useState(true);
  const [notify, setNotify] = useState<boolean | null>(null);
  const [doze, setDoze] = useState<boolean | null>(null);
  const [appData, setAppData] = useState<AppData | null>(null);
  const [shared, setShared] = useState<SharedFolder[]>([]);
  // "add" while the file picker is open, or the grant being given back.
  const [sharedBusy, setSharedBusy] = useState<string | null>(null);
  // What the switch or the way was moved to, shown while su or Shizuku answer.
  const [appDataWanted, setAppDataWanted] = useState<{ on?: boolean; way?: AppDataWay; rootTarget?: boolean } | null>(
    null,
  );
  // The su field's text once edited; it is stored when the field is left.
  const [suDraft, setSuDraft] = useState<string | null>(null);
  // Leaving the field can come before the render of the last keystroke, so
  // the store reads the text from here rather than from that render.
  const suTyped = useRef<string | null>(null);
  const [running, setRunning] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [pairable, setPairable] = useState(false);
  const [vpnOffered, setVpnOffered] = useState(false);
  // Null until read, so the card never shows the built-in values for a moment.
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [lockable, setLockable] = useState(false);
  const [backupFile, setBackupFile] = useState("");
  const [backupFolder, setBackupFolder] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSaid, setBackupSaid] = useState("");
  // Counters, so each export, import or copy that lands swells its button again.
  const [exported, setExported] = useState(0);
  const [imported, setImported] = useState(0);
  const [reported, setReported] = useState(0);
  const [dockered, setDockered] = useState(0);
  const [crypto, setCrypto] = useState(false);
  const [dockerCopied, setDockerCopied] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [rclone, setRclone] = useState<string | null>(null);
  const [updates, setUpdates] = useState(updatesFrom(""));
  const words = useMemo(() => componentText(lang), [lang]);
  const [removing, setRemoving] = useState(false);
  // Counts refusals, so each one shakes the button that was pressed.
  const [removeFailed, setRemoveFailed] = useState(0);
  useEffect(() => {
    if (!dockerCopied) return;
    const id = setTimeout(() => setDockerCopied(false), 1800);
    return () => clearTimeout(id);
  }, [dockerCopied]);
  useEffect(() => {
    if (!reportCopied) return;
    const id = setTimeout(() => setReportCopied(false), 2000);
    return () => clearTimeout(id);
  }, [reportCopied]);

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
  // The system mode belongs to no preset, even where the phone has no colour
  // and the default shows. nearestPreset finds none for it.
  const [accentSlot, setAccentSlot] = useState(() => nearestPreset(ACCENTS.map((a) => a.hex), look.accent));
  const system = useSystemAccent(scheme);
  const seenAccent = useRef(look.accent);
  useEffect(() => {
    if (seenAccent.current !== look.accent) {
      seenAccent.current = look.accent;
      setAccentSlot(nearestPreset(ACCENTS.map((a) => a.hex), look.accent));
    }
  }, [look.accent]);

  const palette = look.palette.length ? look.palette : RAINBOW;
  const themeNames = { dark: t("look.dark"), system: t("phone.system"), light: t("look.light") };
  const oledRefused = oledRefusal(look.theme, { sentence: t("look.oledLight", { ...themeNames }),...themeNames });

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
        backupFile,
      );
      setBackupFile(where);
      setBackupSaid(t("settings.exported", { path: where }));
      setExported((n) => n + 1);
    } catch (e) {
      setBackupSaid((e as Error).message);
    } finally {
      setBackupBusy(false);
    }
  };

  /**
   * Reads the file before asking anything. Our own backup and an automatic
   * backup replace every job, so they ask with the web's sentence; a
   * FolderSync export or a luckyBackup profile shows what it would add beside
   * the jobs already here. Backing out of Android's picker reads nothing and
   * says nothing.
   */
  const confirmImport = async (read: () => Promise<PickedFile | null>) => {
    setBackupBusy(true);
    setBackupSaid("");
    try {
      const file = await read();
      if (!file) return;
      const { name, text } = file;
      const askReplace = (put: () => Promise<unknown>) =>
        Alert.alert(t("backup.import"), t("backup.confirm", { file: name }), [
          { text: t("confirm.cancel"), style: "cancel" },
          { text: t("backup.import"), onPress: () => void restore(put) },
        ]);
      const backup = ownBackup(text);
      if (backup) {
        askReplace(async () => {
          await settingsApi.write(backup.settings as EngineSettings);
          await api.writeConfig(backup.config as never);
        });
        return;
      }
      const plan = await api.checkImport(text);
      const sections = importSections(plan, t)
        .map((s) => `${s.heading}\n${s.lines.map((line) => `• ${line}`).join("\n")}`)
        .join("\n\n");
      if (plan.source === "ArrowLoop") {
        // The engine's whole file, as an automatic backup keeps it.
        askReplace(() => api.replaceConfig(text));
      } else if (plan.jobs.length === 0 && plan.targets.length === 0) {
        setBackupSaid([t("import.nothing"), sections].filter(Boolean).join("\n\n"));
      } else {
        Alert.alert(
          t("import.title", { source: plan.source }),
          `${t("import.confirm", { file: name })}\n\n${sections}`,
          [
            { text: t("confirm.cancel"), style: "cancel" },
            { text: t("import.add"), onPress: () => void addImported(text) },
          ],
        );
      }
    } catch (e) {
      setBackupSaid(errorText(t, e));
    } finally {
      setBackupBusy(false);
    }
  };

  const addImported = async (text: string) => {
    setBackupBusy(true);
    try {
      await api.applyImport(text);
      setBackupSaid(t("import.added"));
      setImported((n) => n + 1);
    } catch (e) {
      setBackupSaid(errorText(t, e));
    } finally {
      setBackupBusy(false);
    }
  };

  const restore = async (put: () => Promise<unknown>) => {
    setBackupBusy(true);
    setBackupSaid("");
    try {
      await put();
      setBackupSaid(t("settings.imported"));
      setImported((n) => n + 1);
      await refresh();
    } catch (e) {
      setBackupSaid((e as Error).message);
    } finally {
      setBackupBusy(false);
    }
  };

  const refresh = useCallback(async () => {
    const [access, can, alive, exempt] = await Promise.all([
      engine.storageGranted(),
      engine.storagePossible(),
      // The process handle is null when the engine was already up at launch.
      engine.answering(),
      engine.batteryExempt(),
    ]);
    setGranted(access);
    setPossible(can);
    setRunning(alive);
    setDoze(exempt);
    engine.hasDeviceLock().then(setLockable, () => setLockable(false));
    // Not awaited: starting the server can take seconds.
    engine.appData().then(setAppData, () => {});
    engine.sharedFolders().then(setShared, () => {});
    // Shows where a backup would go before one exists.
    engine.backupPath().then(
      (where) => setBackupFile((old) => old || where),
      () => {},
    );
    setNotify(await notificationsGranted());
    api.capabilities().then(
      (c) => {
        setVersion(c.version);
        setPairable(c.pairing === true);
        setVpnOffered(c.vpn === true);
      },
      () => setVersion(null),
    );
    api.buildVersions().then(
      (v) => setRclone(v.rclone),
      () => {},
    );
    engine.installer().then(
      (installer) => setUpdates(updatesFrom(installer)),
      () => {},
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Read on every visit, so the card shows what was just changed on the Sync page.
  useFocusEffect(
    useCallback(() => {
      settingsApi.read().then(
        (s) => setDefaults((s.defaults ?? {}) as Defaults),
        () => {},
      );
    }, []),
  );

  // Two of the permissions are granted on system pages with no result
  // callback, so they are read again when the app returns.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  const changeAppData = (
    wanted: { on?: boolean; way?: AppDataWay; rootTarget?: boolean },
    change: () => Promise<AppData>,
  ) => {
    setAppDataWanted(wanted);
    change()
      .then(setAppData, () => {})
      .finally(() => setAppDataWanted(null));
  };
  const changeShared = (busy: string, change: () => Promise<SharedFolder[]>) => {
    setSharedBusy(busy);
    change()
      .then(setShared, () => {})
      .finally(() => setSharedBusy(null));
  };
  const appDataOn = appDataWanted?.on ?? (appData !== null && appData.state !== "off");
  const rootTargetOn = appDataWanted?.rootTarget ?? (appData !== null && appData.rootTarget !== "off");
  // One field for both, shown under Android/data when its way needs su.
  const suUnderAppData = appData !== null && appDataOn && (appData.way === "root" || !appData.root);
  const su = suDraft ?? appData?.su ?? "";
  const suValid = SU_COMMAND.test(su);
  const storeSu = () => {
    const typed = suTyped.current;
    if (appData && typed !== null && SU_COMMAND.test(typed) && typed !== appData.su) {
      changeAppData({}, () => engine.setAppDataSu(typed));
    }
  };
  // Android's back key hides the keyboard but leaves the field focused, so
  // hiding the keyboard stores the entry too.
  const storeSuLater = useRef(storeSu);
  storeSuLater.current = storeSu;
  useEffect(() => {
    const hidden = Keyboard.addListener("keyboardDidHide", () => storeSuLater.current());
    return () => hidden.remove();
  }, []);

  // What a report needs and nothing more. No path, no job or target name and
  // no address: it is meant to be pasted into a public issue.
  const appVersion = Constants.expoConfig?.version ?? "?";
  const report = [
    `app:      ${appVersion} (${Constants.expoConfig?.android?.versionCode ?? "?"})`,
    `engine:   ${version ?? "?"}`,
    `android:  ${Platform.Version}`,
    `language: ${lang}`,
    `look:     design=${look.theme}${look.theme === "system" ? ` (${scheme})` : ""} corners=${look.shape} rainbow=${look.rainbow ? "on" : "off"} labels=${look.labels} bar=${barLabels} motion=${look.motion}${reduced ? " (reduced)" : ""}`,
    `glimstone: ${GLIMSTONE_VERSION}`,
  ].join("\n");

  /**
   * Asks before taking every job and every storage location out of the app,
   * naming how many of each. The files themselves stay where they are. What
   * runs once the answer is given is stopped, and the jobs go only after those
   * runs have ended, so nothing writes after its job is gone.
   */
  const removeAll = async () => {
    try {
      const [config, storage] = await Promise.all([api.config(), api.storage()]);
      const targets = storage.remotes;
      Alert.alert(
        t("danger.removeAll"),
        t("danger.confirm", { jobs: config.jobs.length, targets: targets.length }),
        [
          { text: t("confirm.cancel"), style: "cancel" },
          {
            text: t("danger.confirmButton"),
            // Not "destructive": the question is the warning, not the colour.
            onPress: async () => {
              setRemoving(true);
              try {
                if (!(await stopEvery(api, { within: 30_000, every: 500 }))) throw new Error("a run did not stop");
                await api.writeConfig({ ...(await api.config()), jobs: [] });
                for (const target of targets) await api.deleteRemote(target.name);
              } catch {
                setRemoveFailed((n) => n + 1);
              } finally {
                setRemoving(false);
                waiting.refresh();
              }
            },
          },
        ],
      );
    } catch {
      setRemoveFailed((n) => n + 1);
    }
  };

  const page = (
    <Page>
      {/* The language comes first: somebody who cannot read the screen comes
          looking for exactly this. */}
      <OnTile section="language">
        <Section title={t("look.language")} hue={0}>
          {/* A dropdown that opens a page rather than a list: forty languages
              want a page. The notch names the setting, so the control shows
              only the language in use. */}
          <DropButton
            accessibilityLabel={`${t("look.language")}: ${langName(lang)}`}
            onPress={() => nav.navigate("Language")}
            style={styles.language}
          >
            {/* The flag is an emoji, not a glyph. */}
            <Text style={styles.flag}>{flagEmoji(langFlag(lang))}</Text>
            <Text style={[styles.languageName, { color: p.text }]} numberOfLines={1}>
              {langName(lang)}
            </Text>
          </DropButton>
        </Section>
      </OnTile>

      {/* The defaults at a glance and the way to all of them, as the web's
          Sync tile leads to its page. */}
      <OnTile section="sync">
        <Section title={t("settings.sync")} hint={t("settings.syncHint")} hue={3}>
          <Pair label={t("direction.label")} value={defaults ? directionOf(defaults, t) : ""} />
          <Pair
            label={t("edit.schedule")}
            value={defaults ? sentence(describeValue(inForce(defaults, "schedule"), "schedule", t)) : ""}
          />
          <Button label={t("engine.defaults")} glyph="IconSync" onPress={() => nav.navigate("Sync")} />
        </Section>
      </OnTile>

      {/* An older engine has no built-in VPN, and then no such card. */}
      <OnTile section="integrations">{vpnOffered ? <IntegrationsSection hue={8} /> : null}</OnTile>

      {/* An engine built without pairing has no such page. */}
      <OnTile section="pairing">
        {pairable ? (
          <Section title={t("settings.pairing")} hint={t("pairing.phraseHint")} hue={5}>
            <Button label={t("settings.pairing")} glyph="IconLink" onPress={() => nav.navigate("Pairing")} />
          </Section>
        ) : null}
      </OnTile>

      {/* Each switch reads Android's state; a tap opens the request dialog or
          the settings page, and the switch follows what Android reports when
          the app returns. */}
      <OnTile section="thisPhone">
        <Section title={t("phone.thisPhone")} hue={4}>
          <Toggle
            label={t("phone.access")}
            // On Android 10 the switch cannot move, and the bubble says why.
            hint={possible ? t("phone.permissionHint") : t("phone.accessNone")}
            // Off until the answer arrives.
            value={granted === true}
            disabled={!possible}
            onChange={() => engine.openStorageSettings()}
          />
          <Toggle
            label={t("phone.appData")}
            hint={t("phone.appDataHint")}
            value={appDataOn}
            disabled={appData === null || appDataWanted !== null}
            onChange={(on) => changeAppData({ on }, () => engine.setAppData(on))}
          />
          {appData && appDataOn ? (
            <>
              {/* The way that works is marked until one is picked; a way that
                  cannot work here is dimmed, and the line below says why. */}
              <Choice<AppDataWay>
                hue={0}
                value={appDataWanted?.way ?? appData.way}
                disabled={appDataWanted !== null}
                onChange={(way) => {
                  if (way !== appData.way) changeAppData({ way }, () => engine.setAppDataWay(way));
                }}
                options={[
                  { value: "root", label: t("phone.appDataWayRoot"), disabled: !appData.root },
                  { value: "shizuku", label: "Shizuku", disabled: !appData.shizuku },
                ]}
              />
              {appDataWanted === null && appData.state !== "off" ? (
                <Caption>{appDataSaid(appData.state, appData, t)}</Caption>
              ) : null}
              {!appData.shizuku || appData.state === "noShizuku" ? (
                <Button
                  label={t("phone.appDataGetShizuku")}
                  glyph="IconDownload"
                  hint={t("phone.appDataGetShizukuHint")}
                  onPress={() => Linking.openURL(SHIZUKU_DOWNLOAD)}
                />
              ) : null}
              {/* Also while root is dimmed, since a wrong name for su is one
                  reason it can be. */}
              {suUnderAppData ? (
                <Field
                  label={t("phone.appDataSu")}
                  hint={t("phone.appDataSuHint")}
                  value={su}
                  onChange={(next) => {
                    suTyped.current = next;
                    setSuDraft(next);
                  }}
                  onBlur={storeSu}
                  error={suValid ? undefined : t("phone.appDataSuBad")}
                />
              ) : null}
              {appData.way === "root" && (appData.state === "rootDenied" || appData.state === "noSu") ? (
                <View style={styles.actions}>
                  <Button
                    label={t("phone.appDataRequestRoot")}
                    glyph="IconUnlock"
                    busy={appDataWanted !== null}
                    onPress={() => changeAppData({}, engine.requestRoot)}
                  />
                </View>
              ) : null}
              {appData.state === "shizukuDenied" ? (
                <View style={styles.actions}>
                  <Button
                    label={t("phone.appDataAsk")}
                    glyph="IconUnlock"
                    onPress={() => engine.askShizuku().then(setAppData, () => {})}
                  />
                </View>
              ) : null}
            </>
          ) : null}
          {/* Only su reads the whole file system, so the switch is dimmed
              once su is found missing, unless it is on and has to come off. */}
          <Toggle
            label={t("phone.rootTarget")}
            hint={t("phone.rootTargetHint")}
            value={rootTargetOn}
            disabled={appData === null || appDataWanted !== null || (!appData.root && !rootTargetOn)}
            onChange={(on) => changeAppData({ rootTarget: on }, () => engine.setRootTarget(on))}
          />
          {appData && appDataWanted === null && (rootTargetOn || !appData.root) ? (
            <Caption>{rootTargetSaid(appData.rootTarget, t)}</Caption>
          ) : null}
          {appData && !suUnderAppData && (rootTargetOn || !appData.root) ? (
            <Field
              label={t("phone.appDataSu")}
              hint={t("phone.appDataSuHint")}
              value={su}
              onChange={(next) => {
                suTyped.current = next;
                setSuDraft(next);
              }}
              onBlur={storeSu}
              error={suValid ? undefined : t("phone.appDataSuBad")}
            />
          ) : null}
          {appData &&
          rootTargetOn &&
          (appData.rootTarget === "rootDenied" || appData.rootTarget === "noSu") &&
          !(appDataOn && appData.way === "root" && (appData.state === "rootDenied" || appData.state === "noSu")) ? (
            <View style={styles.actions}>
              <Button
                label={t("phone.appDataRequestRoot")}
                glyph="IconUnlock"
                busy={appDataWanted !== null}
                onPress={() => changeAppData({}, engine.requestRoot)}
              />
            </View>
          ) : null}
          {/* What an app offers in Android's file picker needs neither root
              nor Shizuku, so it stands apart from Android/data. */}
          <Button
            label={t("phone.sharedAdd")}
            glyph="IconFolderAdd"
            hint={t("phone.sharedAddHint")}
            busy={sharedBusy === "add"}
            disabled={sharedBusy !== null}
            onPress={() => changeShared("add", engine.addSharedFolder)}
          />
          {shared.map((folder) => (
            <Row
              key={folder.uri}
              label={`${folder.name} · ${folder.app}`}
              control={
                <Button
                  label={t("phone.sharedRemove")}
                  glyph="IconTrash"
                  wide={false}
                  busy={sharedBusy === folder.uri}
                  disabled={sharedBusy !== null}
                  onPress={() => changeShared(folder.uri, () => engine.removeSharedFolder(folder.uri))}
                />
              }
            />
          ))}
          <Toggle
            label={t("phone.notify")}
            hint={t("phone.permissionHint")}
            value={notify === true}
            onChange={() => {
              // After a refusal Android shows no dialog, so the settings page is
              // the fallback.
              if (notify) engine.openNotificationSettings();
              else askNotifications().then((ok) => (ok ? refresh() : engine.openNotificationSettings()));
            }}
          />
          <Toggle
            label={t("phone.doze")}
            hint={t("phone.dozeOff")}
            value={doze === true}
            onChange={() => engine.openBatterySettings().catch(() => engine.openAppSettings())}
          />
          {/* The phone's own lock rather than an app PIN, so there is no second
              secret to forget. */}
          <Toggle
            label={t("settings.lockOn")}
            hint={lockable ? t("settings.lockHint") : t("settings.lockUnavailable")}
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
      </OnTile>

      {/* The selectors on this page count through the palette in the order
          they stand: the Android/data way, Design, Corners, the two label
          rows, the job list, then Motion. */}
      <OnTile section="appearance">
        <Section title={t("phone.appearance")} hue={1}>
          <AxisLabel>{t("phone.design")}</AxisLabel>
          <Choice<ThemeChoice>
            hue={1}
            value={look.theme}
            onChange={(theme) => setAppearance({ theme })}
            options={[
              { value: "dark", label: t("look.dark"), glyph: "IconMoon" },
              { value: "light", label: t("look.light"), glyph: "IconSun" },
              { value: "system", label: t("phone.system"), glyph: "IconThemeSystem" },
            ]}
          />
          {/* Stepped back while light shows, since it waits for the dark look
              rather than being off. Under Light it refuses instead, and the
              reason has to stay readable. */}
          <View style={scheme === "dark" || oledRefused ? null : styles.dimmed}>
            <Toggle
              label={t("look.oled")}
              hint={t("look.oledHint")}
              value={look.oled}
              onChange={(oled) => setAppearance({ oled })}
              refused={oledRefused}
            />
          </View>

          <AxisLabel hint={t("look.cornersHint")}>{t("look.corners")}</AxisLabel>
          <Choice<Shape>
            hue={2}
            value={look.shape}
            onChange={(shape) => {
              setAppearance({ shape });
              leaf.tap(shape);
            }}
            options={[
              { value: "round", label: t("look.round"), glyph: "IconCornerRound" },
              { value: "soft", label: t("look.soft"), glyph: "IconCornerSoft" },
              { value: "square", label: t("look.square"), glyph: "IconCornerSquare" },
              ...(leaf.offered ? [{ value: "leaf" as Shape, label: t("look.leaf"), glyph: "IconCornerLeaf" }] : []),
            ]}
          />

          {/* Three modes, without the web's pointer-based `reactive`. The bottom
              bar has its own setting, since it fits five words across the width. */}
          <AxisLabel hint={t("look.labelsHint")}>{t("look.labels")}</AxisLabel>
          <Choice<LabelMode>
            hue={3}
            byContent
            // A stored `reactive` shows as symbols, which is how it rendered.
            value={look.labels === "reactive" ? "glyph" : look.labels}
            onChange={(labels) => setAppearance({ labels })}
            options={[
              { value: "text", label: t("look.labelText"), glyph: "IconLabelText" },
              { value: "textGlyph", label: t("look.labelTextGlyph"), glyph: "IconLabelTextGlyph" },
              { value: "glyph", label: t("look.labelGlyph"), glyph: "IconLabelGlyph" },
            ]}
          />
          <AxisLabel hint={t("look.barLabelsHint")}>{t("look.barLabels")}</AxisLabel>
          <Choice<BarLabelMode>
            hue={4}
            byContent
            // The resolved mode, so a stored "same" still lights a segment; see
            // barMode in ui.tsx.
            value={barLabels}
            onChange={(barLabels) => setAppearance({ barLabels })}
            options={[
              { value: "text", label: t("look.labelText"), glyph: "IconLabelText" },
              { value: "textGlyph", label: t("look.labelTextGlyph"), glyph: "IconLabelTextGlyph" },
              { value: "glyph", label: t("look.labelGlyph"), glyph: "IconLabelGlyph" },
            ]}
          />
          <Toggle
            label={t("look.overviewOnBar")}
            hint={t("look.overviewHint")}
            value={look.overviewOnBar}
            onChange={(overviewOnBar) => setAppearance({ overviewOnBar })}
          />
          {pairable ? (
            <Toggle
              label={t("look.instancesInMore")}
              hint={t("look.pinTileHint")}
              value={look.instancesInMore}
              onChange={(instancesInMore) => setAppearance({ instancesInMore })}
            />
          ) : null}

          <AxisLabel hint={t("look.jobViewHint")}>{t("look.jobView")}</AxisLabel>
          <Choice<JobView>
            hue={5}
            value={look.jobView}
            onChange={(jobView) => setAppearance({ jobView })}
            options={[
              { value: "cards", label: t("jobs.view.cards") },
              { value: "compact", label: t("jobs.view.compact") },
            ]}
          />

          {/* Every swatch chooses on the first press and opens the picker on a
              second. The web's reactive switch is left out, since a phone has
              no pointer. */}
          <AxisLabel>{t("look.colors")}</AxisLabel>
          {/* Dimmed rather than hidden while the rainbow is on, so it still shows
              which accent returns when the rainbow is switched off. */}
          <View style={[styles.axisRow, look.rainbow ? styles.dimmed : null]} pointerEvents={look.rainbow ? "none" : "auto"}>
            <View style={styles.axisRowInner}>
              <Body>{t("look.accent")}</Body>
              <View style={styles.swatches}>
                {system ? (
                  <EditableSwatch
                    hex={system}
                    label={t("look.systemAccent")}
                    hint={t("look.systemAccentTip")}
                    glyph="IconAccentSystem"
                    selected={look.accent === SYSTEM_ACCENT}
                    onPress={() => {
                      setAccentSlot(-1);
                      setArmed(null);
                      setAppearance({ accent: SYSTEM_ACCENT });
                    }}
                  />
                ) : null}
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
              disco.turned(rainbow);
            }}
          />

          {look.rainbow && (
            <View>
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

              {disco.offered && (
                <Toggle
                  label={t("look.disco")}
                  hint={t("look.discoHint")}
                  value={look.disco}
                  hue={2}
                  onChange={(on) => setAppearance({ disco: on })}
                />
              )}

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
            </View>
          )}

        </Section>
      </OnTile>

      {/* While the phone asks for less motion the bubble says so, or somebody
          picks the liveliest level, sees nothing move and takes it for a bug.
          The picker stays live: the choice is stored and comes back the
          moment the phone's setting does. The storm is not stopped by it, so
          the sentence does not show then. */}
      <OnTile section="motion">
        <Section
          title={t("look.motion")}
          hint={reduced && look.motion !== "storm" ? `${t("look.motionHint")} ${t("phone.motionReduced")}` : t("look.motionHint")}
          hue={5}
        >
          <Choice<MotionIntensity>
            hue={6}
            value={look.motion}
            onChange={(motion) => {
              // Animated at the new level, as a preview of it.
              animateNext(motion);
              setAppearance({ motion });
              // Taps on the chosen level count towards the storm; see eggs.tsx.
              storm.tap(motion);
            }}
            options={[
              { value: "off", label: t("look.motionOff"), glyph: "IconMotionOff" },
              { value: "subtle", label: t("look.motionSubtle"), glyph: "IconMotionSubtle" },
              { value: "wild", label: t("look.motionWild"), glyph: "IconMotionWild" },
              ...(storm.offered ? [{ value: "storm" as MotionIntensity, label: t("look.motionStorm"), glyph: "IconMotionStorm" }] : []),
            ]}
          />
        </Section>
      </OnTile>

      <OnTile section="engine">
        <Section title={t("phone.syncEngine")} hint={t("phone.engineHint")} hue={9}>
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
                onPress={() => engine.start().then(refresh)}
              />
            )}
          </View>
        </Section>
      </OnTile>

      {/* One file with a fixed name in Downloads unless another place is
          typed or chosen. A file from anywhere else, a cloud app's included,
          comes in through Android's own picker. */}
      <OnTile section="backup">
        <Section title={t("settings.backup")} hint={`${t("settings.backupHint")} ${t("backup.importOthers")}`} hue={10}>
          <Field
            label={t("settings.backupFile")}
            value={backupFile}
            onChange={setBackupFile}
            placeholder="/storage/emulated/0/Download"
          />
          <Button label={t("pick.title")} labelKey="pick.title" onPress={() => setBackupFolder(true)} />
          {/* A folder takes the backup under its fixed name. */}
          <FolderPicker
            visible={backupFolder}
            start={backupFile.slice(0, backupFile.lastIndexOf("/")) || undefined}
            onPick={(path) => {
              setBackupFile(path);
              setBackupFolder(false);
            }}
            onClose={() => setBackupFolder(false)}
          />
          {/* Both side by side in one row, as on the web, and what they cover in
              the card's (i). They share the row, so its edges are the edges of
              the buttons above and below. */}
          <View style={styles.actions}>
            <Button
              label={t("settings.export")}
              labelKey="settings.export"
              busy={backupBusy}
              confirm={exported}
              onPress={exportSettings}
            />
            <Button
              label={t("settings.import")}
              labelKey="settings.import"
              busy={backupBusy}
              confirm={imported}
              onPress={() =>
                void confirmImport(async () => ({ name: backupFile, text: await engine.importSettings(backupFile) }))
              }
            />
          </View>
          <Button
            label={t("settings.importPick")}
            labelKey="settings.importPick"
            busy={backupBusy}
            onPress={() => void confirmImport(engine.pickBackup)}
          />
          {backupSaid ? <Body>{backupSaid}</Body> : null}
        </Section>
      </OnTile>

      <OnTile section="autoBackup">
        <AutoBackupSection hue={11} />
      </OnTile>

      {/* The forms of ArrowLoop a phone is not, in the README's order: the
          server first, then the desktop app. Every download is the newest
          release, and each card names it. */}
      <OnTile section="server">
        <Section title={t("apps.serverTitle")} hint={t("apps.serverHint")} hue={6}>
          <ReadmeRow>
            <ReadmeButton
              label={t("apps.unraid")}
              sub={t("apps.unraidSub")}
              tile={TILE.unraid}
              mark={(lit, ink) => <AppMark svg={UNRAID_SVG} ink={lit ? ink : p.text} />}
              onPress={() => Linking.openURL(UNRAID_CA)}
            />
            <ReadmeButton
              label={t("apps.docker")}
              sub={dockerCopied ? t("apps.copied") : t("apps.dockerSub")}
              tile={TILE.docker}
              hint={`${t("apps.dockerHint")} ${DOCKER_RUN}`}
              mark={(lit, ink) => <AppMark svg={DOCKER_SVG} ink={lit ? ink : PLATFORM[scheme].docker} />}
              confirm={dockered}
              onPress={() =>
                void engine.copy(DOCKER_RUN).then(
                  () => {
                    setDockerCopied(true);
                    setDockered((n) => n + 1);
                  },
                  () => {},
                )
              }
            />
            <ReadmeButton
              label={t("apps.source")}
              sub={t("apps.zipSub")}
              tile={TILE.zip}
              mark={(lit, ink) => <AppMark svg={ZIP_SVG} ink={lit ? ink : p.textSub} />}
              onPress={() => Linking.openURL(sourceZip(version ?? ""))}
            />
          </ReadmeRow>
          <VersionLine version={version} />
        </Section>
      </OnTile>

      {/* A row per system keeps each ARM build beside its own. */}
      <OnTile section="desktop">
        <Section title={t("apps.desktopTitle")} hint={t("apps.desktopHint")} hue={7}>
          <View style={styles.readmeRows}>
            <ReadmeRow>
              <ReadmeButton
                label={t("apps.windows")}
                sub="x64"
                tile={TILE.windows}
                mark={windowsMark}
                onPress={() => Linking.openURL(DOWNLOADS.windows)}
              />
              <ReadmeButton
                label={t("apps.windows")}
                sub="ARM64"
                tile={TILE.windows}
                mark={windowsMark}
                onPress={() => Linking.openURL(DOWNLOADS.windowsArm)}
              />
            </ReadmeRow>
            <ReadmeRow>
              <ReadmeButton
                label={t("apps.macos")}
                sub={t("apps.macosSub")}
                tile={TILE.apple}
                mark={appleMark}
                onPress={() => Linking.openURL(DOWNLOADS.macos)}
              />
              <ReadmeButton
                label={t("apps.macos")}
                sub="Zip"
                tile={TILE.apple}
                mark={appleMark}
                onPress={() => Linking.openURL(DOWNLOADS.macosZip)}
              />
            </ReadmeRow>
            <ReadmeRow>
              <ReadmeButton
                label={t("apps.linux")}
                sub="x64"
                tile={TILE.linux}
                mark={linuxMark}
                onPress={() => Linking.openURL(DOWNLOADS.linux)}
              />
              <ReadmeButton
                label={t("apps.linux")}
                sub="ARM64"
                tile={TILE.linux}
                mark={linuxMark}
                onPress={() => Linking.openURL(DOWNLOADS.linuxArm)}
              />
            </ReadmeRow>
            <ReadmeRow>
              <ReadmeButton
                label={t("apps.appimage")}
                sub="x64"
                tile={TILE.linux}
                mark={linuxMark}
                onPress={() => Linking.openURL(DOWNLOADS.appimage)}
              />
              <ReadmeButton
                label={t("apps.appimage")}
                sub="ARM64"
                tile={TILE.linux}
                mark={linuxMark}
                onPress={() => Linking.openURL(DOWNLOADS.appimageArm)}
              />
            </ReadmeRow>
            <ReadmeRow>
              <ReadmeButton
                label={t("apps.flatpak")}
                sub="x64"
                tile={TILE.flatpak}
                mark={flatpakMark}
                onPress={() => Linking.openURL(DOWNLOADS.flatpak)}
              />
              <ReadmeButton
                label={t("apps.flatpak")}
                sub="ARM64"
                tile={TILE.flatpak}
                mark={flatpakMark}
                onPress={() => Linking.openURL(DOWNLOADS.flatpakArm)}
              />
            </ReadmeRow>
          </View>
          <VersionLine version={version} />
        </Section>
      </OnTile>

      {/* GlimStone's Info tile: Version, Components, Help and About. The
          versions stand in the first two cards and nowhere else. */}
      <OnTile section="version">
        <VersionSection words={words} version={version ?? appVersion} state={updates} hue={0} />
      </OnTile>

      <OnTile section="components">
        <ComponentsSection
          words={words}
          rows={rclone ? [{ name: "rclone", kind: "tool", hint: t("info.rcloneHint"), version: rclone, repoUrl: RCLONE_REPO }] : []}
          hue={1}
        />
      </OnTile>

      <OnTile section="help">
        <Section title={t("info.help")} hint={t("problems.hint")} hue={2}>
          <Body>{t("about.report")}</Body>
          <ReadmeRow>
            <ReadmeButton
              label={t("about.repo")}
              tile={TILE.github}
              mark={(lit, ink) => <DonateMark name="github" scheme={scheme} ink={lit ? ink : undefined} />}
              onPress={() => Linking.openURL(REPO)}
            />
            <ReadmeButton
              label={t("about.discord")}
              tile={TILE.discord}
              mark={(lit, ink) => (
                <BrandMark
                  name="IconDiscord"
                  width={32}
                  height={25}
                  scheme={scheme}
                  lit={lit ? { ink, cut: TILE.discord.color } : undefined}
                />
              )}
              onPress={() => Linking.openURL(DISCORD)}
            />
            {/* The manual is the README's docs button, its book in the
                README's yellow, and the book opens under the finger. */}
            <ReadmeButton
              label={t("phone.manual")}
              sub={t("action.open")}
              tile={TILE.docs}
              mark={(lit, ink) => <ManualMark open={lit} ink={lit ? ink : BRAND[scheme].docs} />}
              onPress={() => Linking.openURL(MANUAL)}
            />
            {/* The report goes with an issue on GitHub, so it lights up beside
                it. It is copied rather than downloaded, ready to paste. */}
            <ReadmeButton
              label={t("info.bugReport")}
              sub={reportCopied ? t("problems.copied") : t("problems.copy")}
              tile={TILE.github}
              mark={(lit, ink) => <Glyph name="IconDiagnostics" color={lit ? ink : p.text} />}
              confirm={reported}
              onPress={() =>
                // The line changes only once the copy has landed.
                void engine.copy(report).then(
                  () => {
                    setReportCopied(true);
                    setReported((n) => n + 1);
                  },
                  () => {},
                )
              }
            />
          </ReadmeRow>
        </Section>
      </OnTile>

      {/* GlimStone's About card: who made it and the ways to give, then the
          privacy policy. The title counts the taps for the loop egg, being the
          only part of the card with no other action. */}
      <OnTile section="about">
        <Section title={t("about.title")} hue={3} onTitlePress={loop.tap}>
          {loop.mark}
          <Body>{t("about.body")}</Body>

          <Body>{t("about.coffee")}</Body>
          {/* The README's give buttons, a blank line below the sentence above,
              since they are the loudest row on the card. Brand marks are passed
              explicitly, never matched from the label key. */}
          <ReadmeRow style={styles.give}>
            <ReadmeButton
              label={t("about.coffeeButton")}
              art
              tile={TILE.coffee}
              mark={(lit, ink) => <CoffeeArt cup={lit ? ink : BRAND[scheme].coffee} ink={ink} />}
              onPress={() => Linking.openURL(COFFEE)}
            />
            <ReadmeButton
              label={t("about.paypal")}
              tile={TILE.paypal}
              mark={(lit, ink) => <DonateMark name="paypal" scheme={scheme} ink={lit ? ink : undefined} />}
              onPress={() => Linking.openURL(PAYPAL)}
            />
            <ReadmeButton
              label={t("about.crypto")}
              tile={TILE.bitcoin}
              mark={(lit, ink) => <DonateMark name="bitcoin" scheme={scheme} ink={lit ? ink : undefined} />}
              onPress={() => setCrypto(true)}
            />
          </ReadmeRow>

          <Caption>
            <Text accessibilityRole="link" onPress={() => Linking.openURL(PRIVACY)} style={{ color: accentInk }}>
              {t("phone.privacy")}
            </Text>
          </Caption>
        </Section>
      </OnTile>

      {/* Quiet, with a glyph and no red: the question it asks is the warning. */}
      <OnTile section="danger">
        <Section title={t("danger.title")} hue={6}>
          <View style={styles.actions}>
            <Button
              label={t("danger.removeAll")}
              glyph="IconTrash"
              busy={removing}
              shake={removeFailed}
              onPress={() => void removeAll()}
            />
          </View>
        </Section>
      </OnTile>

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

  // Beside the side bar, the web's Settings: its tiles in a column and the
  // page of the one picked beside them. Sync, Targets and Pairing are screens
  // of their own on the phone and show whole. The page keeps its place in the
  // tree either way, so turning the tablet keeps where it was scrolled to.
  const tiles = settingsTiles({ pairable, vpn: vpnOffered });
  const shown = shownTile(tiles, picked);
  const screen = frame.wide ? tiles.find((tile) => tile.id === shown)?.screen : undefined;
  const pane = useMemo(() => (frame.wide ? { wide: true, width: paneWidth(frame.width), fill: true } : frame), [frame]);
  return (
    <View style={frame.wide ? styles.besideTiles : styles.fill}>
      {frame.wide ? <SettingsTiles tiles={tiles} shown={shown} onPick={setPicked} /> : null}
      <FrameProvider value={pane}>
        <View style={styles.fill}>
          <ShownTile.Provider value={frame.wide ? shown : null}>
            {screen === "Sync" ? <SyncSettings /> : screen === "TargetList" ? <Targets /> : screen === "Pairing" ? <Pairing /> : page}
          </ShownTile.Provider>
        </View>
      </FrameProvider>
    </View>
  );
}

/** The tile on show beside the side bar, or null on a phone, which shows every card. */
const ShownTile = createContext<TileId | null>(null);

/** A card of the page, shown on a phone and on its own tile beside the side bar. */
function OnTile({ section, children }: { section: SectionId; children: ReactNode }) {
  const shown = useContext(ShownTile);
  return shown === null || SECTION_TILE[section] === shown ? children : null;
}

/**
 * The web's column of tiles, its tab selector turned on its side, the open
 * one filled with its palette position or the accent.
 */
function SettingsTiles({ tiles, shown, onPick }: { tiles: SettingsTile[]; shown: TileId; onPick: (id: TileId) => void }) {
  const { t } = useT();
  const { p, corners, accent, accentInk, hueAt } = useTheme();
  return (
    <ScrollView
      style={styles.tiles}
      contentContainerStyle={styles.tilesInside}
      accessibilityRole="tablist"
    >
      {tiles.map((tile, i) => {
        const on = tile.id === shown;
        const fill = hueAt(i) ?? accent;
        const ink = on ? contrastOn(fill) : p.textSub;
        return (
          <Press
            key={tile.id}
            accessibilityRole="tab"
            accessibilityState={on ? { selected: true } : {}}
            onPress={() => onPick(tile.id)}
            android_ripple={{ color: p.hover }}
            style={[styles.tile, { backgroundColor: on ? fill : p.surface2, ...corners.pill }]}
          >
            <Glyph name={tile.glyph} color={on ? ink : (hueAt(i) ?? accentInk)} size={20} />
            <Text style={[styles.tileText, { color: on ? ink : p.textSub }]} numberOfLines={2}>
              {t(tile.label)}
            </Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

/**
 * The release the download buttons above it give, as a link where the version
 * is a plain release number.
 */
function VersionLine({ version }: { version: string | null }) {
  const { t } = useT();
  const { accentInk } = useTheme();
  if (!version) return null;
  const label = `${t("about.version")} ${version.replace(/^v/, "")}`;
  if (!isRelease(version)) return <Caption>{label}</Caption>;
  return (
    <Caption>
      <Text onPress={() => Linking.openURL(releaseUrl(version))} style={[styles.link, { color: accentInk }]}>
        {label}
      </Text>
    </Caption>
  );
}

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

/** Whether a version stamp names a release rather than a build after one. */
function isRelease(version: string | null): version is string {
  return Boolean(version && /^v?\d+\.\d+\.\d+$/.test(version));
}

/**
 * Returns the release page for a version stamp. The stamp comes from
 * `git describe`, so a build after a tag (`v0.7.0-47-g7b39f19`) has no page of
 * its own and gets the releases list.
 */
function releaseUrl(version: string | null): string {
  if (isRelease(version)) return `${REPO}/releases/tag/${version.startsWith("v") ? version : `v${version}`}`;
  return `${REPO}/releases`;
}

/**
 * The default direction as the Sync page's selector names it, by the sides a
 * phone stacks rather than left and right, with the mode where it has one.
 */
function directionOf(defaults: Defaults, t: T): string {
  const { direction, mode } = inForce(defaults, "direction");
  const way = wayOf(direction);
  const named = wayLabel(way, t("side.onDevice"), t("side.target"), t("direction.both"));
  if (way === "both") return named;
  return `${named}, ${t(mode === "mirror" ? "mode.mirror" : mode === "move" ? "mode.move" : "mode.sync")}`;
}

/**
 * Shizuku's own download page, which lists Google Play, F-Droid and GitHub,
 * so the F-Droid build sends nobody to Play.
 */
const SHIZUKU_DOWNLOAD = "https://shizuku.rikka.app/download/";

/** A command name or an absolute path, either without spaces. */
const SU_COMMAND = /^(\/[^\s/]+)+$|^[^\s/]+$/;

/**
 * The line under the Android/data way: what it can do or why it cannot,
 * then why a way is dimmed where that is not already said.
 */
function appDataSaid(state: Exclude<AppDataState, "off">, ways: Pick<AppData, "root" | "shizuku">, t: T): string {
  const said = [stateSaid(state, t)];
  if (!ways.root && state !== "noSu" && state !== "noWay") said.push(t("phone.appDataNoSu"));
  if (!ways.shizuku && state !== "noShizuku" && state !== "noWay") said.push(t("phone.appDataNoShizuku"));
  return said.join(" ");
}

/**
 * The line under the Root target's switch: what it does or why it cannot,
 * and while it is off and dimmed, why.
 */
function rootTargetSaid(state: RootTargetState, t: T): string {
  switch (state) {
    case "off":
      return t("phone.appDataNoSu");
    case "root":
      return t("phone.rootTargetOn");
    case "failed":
      return t("phone.rootTargetFailed");
    default:
      return stateSaid(state, t);
  }
}

function stateSaid(state: Exclude<AppDataState, "off">, t: T): string {
  switch (state) {
    case "root":
      return t("phone.appDataRoot");
    case "shizuku":
      return t("phone.appDataShizuku");
    case "noWay":
      return t("phone.appDataNoWay");
    case "noSu":
      return t("phone.appDataNoSu");
    case "rootDenied":
      return t("phone.appDataRootDenied");
    case "noShizuku":
      return t("phone.appDataNoShizuku");
    case "shizukuStopped":
      return t("phone.appDataStopped");
    case "shizukuDenied":
      return t("phone.appDataDenied");
    case "failed":
      return t("phone.appDataFailed");
  }
}

/** A cadence starts mid-sentence in lower case; standing alone it takes a capital. */
function sentence(said: string): string {
  return said.charAt(0).toLocaleUpperCase() + said.slice(1);
}

function langName(code: string): string {
  // Required lazily; LANGUAGES is all this needs from the module.
  const { LANGUAGES } = require("../i18n") as typeof import("../i18n");
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/** A backup this app exported, which carries the engine's settings beside the jobs. */
interface OwnBackup {
  settings: unknown;
  config: unknown;
}

/** The backup in text, or null for any other file. */
function ownBackup(text: string): OwnBackup | null {
  try {
    const backup = JSON.parse(text) as { kind?: string; settings?: unknown; config?: unknown };
    return backup.kind === "arrowloop-settings" && backup.settings && backup.config
      ? { settings: backup.settings, config: backup.config }
      : null;
  } catch {
    return null;
  }
}

/** The flag's country code for a language, empty for one the app does not list. */
function langFlag(code: string): string {
  const { LANGUAGES } = require("../i18n") as typeof import("../i18n");
  return LANGUAGES.find((l) => l.code === code)?.flag ?? "";
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  besideTiles: { flex: 1, flexDirection: "row" },
  // The web's room before the column, and its top level with the first
  // card's title, which stands in the card's top margin below the page's own
  // room.
  tiles: { width: TILE_COLUMN + space.xl, flexGrow: 0 },
  tilesInside: { gap: space.xs, paddingStart: space.xl, paddingTop: pageTop(false) + space.md, paddingBottom: space.lg },
  // The web's tile at a finger's height.
  tile: {
    minHeight: TOUCH,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: 14,
    paddingVertical: space.xs,
  },
  tileText: { flex: 1, fontSize: 15, fontWeight: "500", lineHeight: 20 },
  // Wraps, or a row of three buttons clips the last one on a narrow phone.
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  axisRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  axisName: { flexDirection: "row", alignItems: "center", gap: space.sm },
  axisRowInner: { flexDirection: "row", alignItems: "center", gap: space.md, flex: 1 },
  dimmed: { opacity: 0.4 },
  // The key-control height, as the fields and buttons further down.
  language: { minHeight: TOUCH, gap: space.md },
  languageName: { flex: 1, fontSize: text.body },
  flag: { fontSize: text.title },
  link: { fontVariant: ["tabular-nums"] },
  // The README buttons' own gap, 13 on the README's 16.
  readmeRows: { gap: README_GAP },
  // A blank line of the card's text above and below.
  give: { marginVertical: text.body * 1.5 },
  // Shares the width left after the label equally, so all swatches fit on
  // one line at any width.
  swatches: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, justifyContent: "flex-end" },
});
