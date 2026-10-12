import {
  CommonActions,
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  type ParamListBase,
  type RouteProp,
} from "@react-navigation/native";
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabBarProps,
} from "@react-navigation/material-top-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { I18nProvider, useT } from "./src/i18n";
import {
  BAR,
  MORE,
  type BarPlace,
  type ConflictsStack,
  type HistoryStack,
  type JobsStack,
  type MorePlace,
  type MoreStack,
  type SettingsStack,
} from "./src/nav";
import { History } from "./src/screens/History";
import { JobEdit } from "./src/screens/JobEdit";
import { Jobs } from "./src/screens/Jobs";
import { Language } from "./src/screens/Language";
import { Plan } from "./src/screens/Plan";
import { Settings } from "./src/screens/Settings";
import { SyncSettings } from "./src/screens/SyncSettings";
import { TargetEdit } from "./src/screens/TargetEdit";
import { TargetPick } from "./src/screens/TargetPick";
import { Targets } from "./src/screens/Targets";
import { Trash } from "./src/screens/Trash";
import { TrashAll } from "./src/screens/TrashAll";
import { Anomalies } from "./src/screens/Anomalies";
import { Conflicts } from "./src/screens/Conflicts";
import { askNotifications, notificationsGranted } from "./src/screens/Settings";
import { useDiscoWalk } from "./src/disco";
import { useMotion } from "./src/motion";
import { loadAppearance, useAppearance } from "./src/settings";
import { contrastOn, space, text } from "./src/theme";
import { Glyph } from "./src/glyphs";
import { Badge, Body, Button, Heading, Press, Screen, usePress, useTheme } from "./src/ui";
import { engine } from "./src/engine";
import { useEngine } from "./src/useEngine";
import { useWaiting, WaitingProvider } from "./src/waiting";

// Four places on the bar and More for the rest. Each tab has its own stack, so
// back returns within the tab. The tabs use the material top tab navigator
// with its bar at the bottom, because the bottom tab navigator has no pager to
// swipe between pages; swiping is off once a tab has left its root screen,
// where a sideways drag belongs to the screen.
const Tabs = createMaterialTopTabNavigator();
const JobsNav = createNativeStackNavigator<JobsStack>();
const ConflictsNav = createNativeStackNavigator<ConflictsStack>();
const HistoryNav = createNativeStackNavigator<HistoryStack>();
const SettingsNav = createNativeStackNavigator<SettingsStack>();
const MoreNav = createNativeStackNavigator<MoreStack>();

export default function App() {
  // Loaded before the first paint, so nothing flashes in the wrong theme.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadAppearance().finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <Shell />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { p, scheme, accent } = useTheme();
  const { t } = useT();
  const { state, log, retry } = useEngine(t);
  const look = useAppearance();
  useDiscoWalk();

  // The optional lock gates the whole app, since the job list alone shows
  // every synced path. It closes again after AWAY_MS in the background.
  const [locked, setLocked] = useState(look.lock);
  const left = useRef(0);

  const unlock = useCallback(() => {
    engine
      .confirmDeviceLock(t("settings.locked"), t("settings.lockHint"))
      .then((ok) => ok && setLocked(false))
      .catch(() => {});
  }, [t]);

  useEffect(() => {
    // Switching the lock on takes effect the next time the app is left.
    if (!look.lock) setLocked(false);
  }, [look.lock]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (look.lock && left.current && Date.now() - left.current > AWAY_MS) setLocked(true);
        left.current = 0;
      } else if (next === "background") {
        left.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [look.lock]);

  // A locked app opens straight into the phone's own unlock dialog.
  useEffect(() => {
    if (locked) unlock();
  }, [locked, unlock]);

  // So the navigator's own chrome uses GlimStone's colours.
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: accent,
      background: p.background,
      card: p.surface,
      text: p.text,
      border: p.border,
      notification: accent,
    },
  };

  const header = {
    headerStyle: { backgroundColor: p.background },
    headerTitleStyle: { color: p.text, fontSize: text.title, fontWeight: "600" },
    headerTintColor: p.text,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: p.background },
  } as const;

  // Asks for the notification permission once the engine is up; the settings
  // screen covers a later change of mind.
  useEffect(() => {
    if (state !== "ready") return;
    let gone = false;
    notificationsGranted().then((has) => {
      if (!gone && !has) void askNotifications();
    });
    return () => {
      gone = true;
    };
  }, [state]);

  if (locked) return <Locked onUnlock={unlock} />;

  if (state !== "ready") return <Waiting state={state} log={log} onRetry={retry} />;

  return (
    <WaitingProvider>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <NavigationContainer theme={navTheme}>
        <Tabs.Navigator
          tabBarPosition="bottom"
          screenOptions={({ route }) => ({
            swipeEnabled: !deeperThanRoot(route),
            // TabBar draws the floating bar itself; the navigator's own bar
            // only keeps its reserved height.
            tabBarStyle: {
              backgroundColor: "transparent",
              borderTopWidth: 0,
              elevation: 0,
            },
          })}
          tabBar={(props) => <TabBar {...props} />}
        >
          <Tabs.Screen name="JobsTab" options={{ title: t("nav.jobs") }}>
            {() => (
              <JobsNav.Navigator screenOptions={header}>
                <JobsNav.Screen name="JobList" component={Jobs} options={{ title: t("jobs.title") }} />
                {/* Opening and editing a job share one screen under two route names. */}
                <JobsNav.Screen name="JobDetail" component={JobEdit} options={{ title: "" }} />
                <JobsNav.Screen
                  name="JobEdit"
                  component={JobEdit}
                  options={({ route }) => ({
                    title: route.params?.name ? t("edit.editJob") : t("edit.add"),
                  })}
                />
                <JobsNav.Screen name="Plan" component={Plan} options={{ title: t("preview.title") }} />
                <JobsNav.Screen name="Anomalies" component={Anomalies} options={{ title: t("nav.anomalies") }} />
                <JobsNav.Screen name="Trash" component={Trash} options={{ title: t("nav.trash") }} />
              </JobsNav.Navigator>
            )}
          </Tabs.Screen>

          <Tabs.Screen name="ConflictsTab" options={{ title: t("nav.conflicts") }}>
            {() => (
              <ConflictsNav.Navigator screenOptions={header}>
                <ConflictsNav.Screen
                  name="ConflictList"
                  component={Conflicts}
                  options={{ title: t("nav.conflicts") }}
                />
              </ConflictsNav.Navigator>
            )}
          </Tabs.Screen>

          <Tabs.Screen name="HistoryTab" options={{ title: t("nav.history") }}>
            {() => (
              <HistoryNav.Navigator screenOptions={header}>
                <HistoryNav.Screen name="RunList" component={History} options={{ title: t("history.title") }} />
              </HistoryNav.Navigator>
            )}
          </Tabs.Screen>

          <Tabs.Screen name="SettingsTab" options={{ title: t("nav.settings") }}>
            {() => (
              <SettingsNav.Navigator screenOptions={header}>
                <SettingsNav.Screen name="SettingsHome" component={Settings} options={{ title: t("nav.settings") }} />
                <SettingsNav.Screen name="Language" component={Language} options={{ title: t("look.language") }} />
                <SettingsNav.Screen name="Sync" component={SyncSettings} options={{ title: t("engine.defaults") }} />
              </SettingsNav.Navigator>
            )}
          </Tabs.Screen>

          {/* The places behind More share one tab. Picking one makes it the
              stack's first screen, so back from a target's form returns to
              the targets, and a swipe from Settings lands where More last led. */}
          <Tabs.Screen name="MoreTab" options={{ title: t("more.title") }}>
            {() => (
              <MoreNav.Navigator screenOptions={header}>
                <MoreNav.Screen name="TrashAll" component={TrashAll} options={{ title: t("nav.trash") }} />
                <MoreNav.Screen name="TargetList" component={Targets} options={{ title: t("targets.title") }} />
                <MoreNav.Screen name="TargetPick" component={TargetPick} options={{ title: t("targets.addStorage") }} />
                <MoreNav.Screen name="TargetEdit" component={TargetEdit} options={{ title: t("action.edit") }} />
                <MoreNav.Screen name="Anomalies" component={Anomalies} options={{ title: t("nav.anomalies") }} />
              </MoreNav.Navigator>
            )}
          </Tabs.Screen>
        </Tabs.Navigator>
      </NavigationContainer>
    </WaitingProvider>
  );
}

/** The bar's fixed height; see the segment style. */
const BAR_H = 48;

/**
 * The bottom bar, drawn by hand because react-navigation's bar cannot follow
 * the label setting, fill the current tab, or centre a glyph when no label is
 * drawn. It is a well, GlimStone's horizontal selector, with four equal places
 * and More, which opens the rest as a sheet.
 */
function TabBar({ state, navigation }: MaterialTopTabBarProps) {
  const { p, corners } = useTheme();
  const { t } = useT();
  const { running, conflicts } = useWaiting();
  const inset = useSafeAreaInsets();
  const [sheet, setSheet] = useState(false);
  const current = state.routes[state.index]?.name;
  const counts: Record<BarPlace["tab"], number | null> = {
    JobsTab: running,
    ConflictsTab: conflicts,
    HistoryTab: null,
    SettingsTab: null,
  };
  // Clear of the gesture bar, with a floor for phones with buttons.
  const below = Math.max(inset.bottom, space.sm);

  const go = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented) navigation.navigate(name);
  };

  return (
    <View>
      {/* The app's ground under the bar, or Android's near-white window
          background shows through around it. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.background }]} />
      <View style={[styles.bar, { backgroundColor: p.surface2, ...corners.pill, marginBottom: below }]}>
        <View style={styles.well}>
          {BAR.map((place, index) => (
            <BarSegment
              key={place.tab}
              label={t(place.label)}
              glyph={place.glyph}
              index={index}
              on={current === place.tab}
              count={counts[place.tab]}
              onPress={() => go(place.tab)}
            />
          ))}
          <BarSegment
            label={t("more.title")}
            glyph="IconMore"
            index={BAR.length}
            on={current === "MoreTab"}
            onPress={() => setSheet(true)}
          />
        </View>
      </View>
      <MoreSheet
        open={sheet}
        above={below + BAR_H + 6}
        onClose={() => setSheet(false)}
        onPick={(screen) => {
          setSheet(false);
          // The picked place replaces whatever More held, rather than piling
          // up on it.
          const at = state.routes.findIndex((r) => r.name === "MoreTab");
          // Handed over as a partial state, so the router fills in the rest.
          const partial = {
            index: at,
            routes: state.routes.map((r, i) => ({
              key: r.key,
              name: r.name,
              params: r.params,
              state: i === at ? { routes: [{ name: screen }] } : r.state,
            })),
          };
          navigation.dispatch(CommonActions.reset(partial as Parameters<typeof CommonActions.reset>[0]));
        }}
      />
    </View>
  );
}

/**
 * One place on the bar. The current one is filled with its palette position,
 * or the accent without the rainbow. A count stands grey at the glyph's corner
 * and swaps to the fill's colours on the current place.
 */
function BarSegment({
  label,
  glyph,
  index,
  on,
  count,
  onPress,
}: {
  label: string;
  glyph: string;
  index: number;
  on: boolean;
  count?: number | null;
  onPress: () => void;
}) {
  // The bar has its own label setting.
  const { p, corners, barLabels, accent, hueAt } = useTheme();
  const press = usePress();
  const showGlyph = barLabels !== "text";
  const showWord = barLabels !== "glyph";
  const fill = hueAt(index) ?? accent;
  const ink = on ? contrastOn(fill) : p.textSub;
  const badge = count ? (
    <View style={[styles.count, { backgroundColor: on ? ink : p.surface3, ...corners.pill }]}>
      <Text style={[styles.countText, { color: on ? fill : p.text }]}>{count}</Text>
    </View>
  ) : null;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={on ? { selected: true } : {}}
      accessibilityLabel={count ? `${label}, ${count}` : label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={{ color: p.hover }}
      style={[
        styles.segment,
        {
          ...corners.pill,
          backgroundColor: on ? fill : "transparent",
          opacity: press.dim,
          transform: [{ scale: press.scale }],
        },
      ]}
    >
      {showGlyph ? (
        <View>
          <Glyph name={glyph} color={ink} size={20} />
          {badge}
        </View>
      ) : null}
      {showWord ? (
        <View>
          <Text
            numberOfLines={1}
            // Shrinks rather than truncates, like the horizontal selector.
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.tabText, { color: ink }]}
          >
            {label}
          </Text>
          {showGlyph ? null : badge}
        </View>
      ) : null}
    </AnimatedPressable>
  );
}

/**
 * The places that do not fit on the bar, as a sheet standing just above it.
 * A tap outside or Android's back closes it, as it closes a card's menu.
 */
function MoreSheet({
  open,
  above,
  onClose,
  onPick,
}: {
  open: boolean;
  /** How far the bar reaches up from the bottom edge. */
  above: number;
  onClose: () => void;
  onPick: (screen: MorePlace["screen"]) => void;
}) {
  const { p, corners } = useTheme();
  const { t } = useT();
  const { ms } = useMotion();
  const { findings, trash } = useWaiting();
  const counts: Record<MorePlace["screen"], number | null> = {
    TrashAll: trash,
    TargetList: null,
    Anomalies: findings?.length ?? null,
  };
  const held = findings?.some((f) => f.held) ?? false;

  return (
    <Modal visible={open} transparent animationType={ms.fade ? "fade" : "none"} onRequestClose={onClose}>
      <Pressable style={[styles.ground, { backgroundColor: p.scrim, paddingBottom: above }]} onPress={onClose}>
        {/* Swallows presses, so a tap between the rows does not close it. */}
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: p.surface, ...corners.card }]}>
          {MORE.map((place) => {
            const count = counts[place.screen];
            return (
              <Press
                key={place.screen}
                accessibilityRole="button"
                onPress={() => onPick(place.screen)}
                android_ripple={{ color: p.hover }}
                style={[styles.sheetRow, { backgroundColor: p.surface2, ...corners.control }]}
              >
                <Glyph name={place.glyph} color={p.text} size={20} />
                <Text style={[styles.sheetText, { color: p.text }]} numberOfLines={1}>
                  {t(place.label)}
                </Text>
                {count ? (
                  <Badge label={String(count)} tone={place.screen === "Anomalies" && held ? "warn" : "neutral"} />
                ) : null}
              </Press>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Created at module level, so a render does not make a new component type.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Reports whether a tab's stack has moved off its first screen. A tab whose
 * stack has not rendered yet has no state and counts as at its first screen.
 */
function deeperThanRoot(route: RouteProp<ParamListBase>): boolean {
  const stack = (route as { state?: { index?: number; routes: unknown[] } }).state;
  if (!stack) return false;
  return (stack.index ?? stack.routes.length - 1) > 0;
}

/**
 * The screen in front of a locked app. Its button reopens the system dialog
 * after it has been dismissed.
 */
function Locked({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useT();
  return (
    <Screen>
      <Heading>{t("settings.locked")}</Heading>
      <Body>{t("settings.lockHint")}</Body>
      <Button label={t("settings.unlock")} labelKey="settings.unlock" tone="accent" onPress={onUnlock} />
    </Screen>
  );
}

/**
 * Time in the background before the lock closes again. Locking at once would
 * ask for the PIN after every glance at a message.
 */
const AWAY_MS = 60 * 1000;

/**
 * The screen while the engine starts, and the engine's log when it does not
 * answer.
 */
function Waiting({ state, log, onRetry }: { state: string; log: string; onRetry: () => void }) {
  const { p, corners } = useTheme();
  const { t } = useT();
  // This screen is outside the navigator, so it applies the insets itself.
  const inset = useSafeAreaInsets();
  if (state === "starting") {
    return (
      <Screen>
        <View style={[styles.centre, { paddingTop: inset.top }]}>
          <Heading>{t("preview.starting")}</Heading>
          <Body muted>{t("engine.loading")}</Body>
        </View>
      </Screen>
    );
  }
  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.trouble, { paddingTop: inset.top + space.lg }]}>
        <Heading>{t("error.unreachable")}</Heading>
        <Text
          style={[
            styles.log,
            { color: p.textSub, backgroundColor: p.surface, ...corners.card },
          ]}
        >
          {log}
        </Text>
        <Button label={t("phone.engineStart")} labelKey="phone.engineStart" tone="accent" onPress={onRetry} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
    gap: space.sm,
  },
  trouble: { padding: space.lg, gap: space.md },
  log: { fontFamily: "monospace", fontSize: text.meta, padding: space.md },

  // Inset from the edges so the bar floats on the page.
  bar: { marginHorizontal: space.md, padding: 3 },
  well: { flexDirection: "row", gap: 2 },
  // Equal widths whatever the words, and a fixed height so the bar does not
  // change size with the label setting. 48 fits glyph, gap, caption and
  // padding.
  segment: {
    flex: 1,
    minWidth: 0,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  tabText: { fontSize: text.meta, fontWeight: "500" },
  // At the glyph's top corner, over the edge of the segment's content.
  count: {
    position: "absolute",
    top: -4,
    end: -12,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: text.meta, lineHeight: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },

  // Fills the screen so a tap anywhere closes the sheet; the sheet itself
  // stands at the bottom, over the bar's end.
  ground: { flex: 1, justifyContent: "flex-end", paddingHorizontal: space.md },
  sheet: { padding: space.sm, gap: space.xs, elevation: 8 },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.lg,
  },
  sheetText: { flex: 1, fontSize: text.body },
});
