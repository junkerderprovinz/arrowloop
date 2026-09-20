import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  getFocusedRouteNameFromRoute,
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
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { I18nProvider, useT } from "./src/i18n";
import type { HistoryStack, JobsStack, OverviewStack, SettingsStack, TargetsStack } from "./src/nav";
import { History } from "./src/screens/History";
import { JobEdit } from "./src/screens/JobEdit";
import { Jobs } from "./src/screens/Jobs";
import { Language } from "./src/screens/Language";
import { Overview } from "./src/screens/Overview";
import { Plan } from "./src/screens/Plan";
import { RunDetail } from "./src/screens/RunDetail";
import { Settings } from "./src/screens/Settings";
import { SyncSettings } from "./src/screens/SyncSettings";
import { TargetEdit } from "./src/screens/TargetEdit";
import { TargetPick } from "./src/screens/TargetPick";
import { Targets } from "./src/screens/Targets";
import { Trash } from "./src/screens/Trash";
import { askNotifications, notificationsGranted } from "./src/screens/Settings";
import { loadAppearance, useAppearance } from "./src/settings";
import { contrastOn, space, text } from "./src/theme";
import { Glyph } from "./src/glyphs";
import { Body, Button, Heading, Screen, useTheme } from "./src/ui";
import { engine } from "./src/engine";
import { useEngine } from "./src/useEngine";

// Five tabs: the overview first, then the desktop's four. Each tab has its own
// stack, so back returns within the tab. The tabs use the material top tab
// navigator with its bar at the bottom, because the bottom tab navigator has no
// pager to swipe between pages; swiping is off once a tab has left its root
// screen, where a sideways drag belongs to the screen.
const Tabs = createMaterialTopTabNavigator();
const OverviewNav = createNativeStackNavigator<OverviewStack>();
const JobsNav = createNativeStackNavigator<JobsStack>();
const HistoryNav = createNativeStackNavigator<HistoryStack>();
const TargetsNav = createNativeStackNavigator<TargetsStack>();
const SettingsNav = createNativeStackNavigator<SettingsStack>();

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
  const { p, scheme, radius, accent } = useTheme();
  const { t } = useT();
  const { state, log, retry } = useEngine(t);
  const look = useAppearance();

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
    headerTitleStyle: { color: p.text, fontSize: text.title },
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
    <>
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
          <Tabs.Screen
            name="OverviewTab"
            options={{ title: t("nav.overview") }}
          >
            {() => (
              <OverviewNav.Navigator screenOptions={header}>
                {/* The first screen carries the product name, untranslated;
                    its tab keeps the translated label. */}
                <OverviewNav.Screen
                  name="OverviewHome"
                  component={Overview}
                  options={{ title: "ArrowLoop" }}
                />
              </OverviewNav.Navigator>
            )}
          </Tabs.Screen>

          <Tabs.Screen
            name="JobsTab"
            options={{ title: t("nav.jobs") }}
          >
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
                <JobsNav.Screen name="Trash" component={Trash} options={{ title: t("phone.bin") }} />
              </JobsNav.Navigator>
            )}
          </Tabs.Screen>

          <Tabs.Screen
            name="HistoryTab"
            options={{ title: t("nav.history") }}
          >
            {() => (
              <HistoryNav.Navigator screenOptions={header}>
                <HistoryNav.Screen
                  name="RunList"
                  component={History}
                  options={{ title: t("history.title") }}
                />
                <HistoryNav.Screen
                  name="RunDetail"
                  component={RunDetail}
                  options={{ title: t("jobs.activity") }}
                />
              </HistoryNav.Navigator>
            )}
          </Tabs.Screen>

          <Tabs.Screen
            name="TargetsTab"
            options={{ title: t("nav.targets") }}
          >
            {() => (
              <TargetsNav.Navigator screenOptions={header}>
                <TargetsNav.Screen
                  name="TargetList"
                  component={Targets}
                  options={{ title: t("targets.title") }}
                />
                <TargetsNav.Screen
                  name="TargetPick"
                  component={TargetPick}
                  options={{ title: t("targets.addStorage") }}
                />
                <TargetsNav.Screen
                  name="TargetEdit"
                  component={TargetEdit}
                  options={{ title: t("action.edit") }}
                />
              </TargetsNav.Navigator>
            )}
          </Tabs.Screen>

          <Tabs.Screen
            name="SettingsTab"
            options={{ title: t("nav.settings") }}
          >
            {() => (
              <SettingsNav.Navigator screenOptions={header}>
                <SettingsNav.Screen
                  name="SettingsHome"
                  component={Settings}
                  options={{ title: t("settings.section") }}
                />
                <SettingsNav.Screen
                  name="Language"
                  component={Language}
                  options={{ title: t("look.language") }}
                />
                <SettingsNav.Screen
                  name="Sync"
                  component={SyncSettings}
                  options={{ title: t("engine.defaults") }}
                />
              </SettingsNav.Navigator>
            )}
          </Tabs.Screen>
        </Tabs.Navigator>
      </NavigationContainer>
    </>
  );
}

/**
 * The bottom bar, drawn by hand because react-navigation's bar cannot follow
 * the label setting, fill the current tab, or centre a glyph when no label is
 * drawn. It is a well, GlimStone's horizontal selector, with equal segments.
 */
function TabBar({ state, descriptors, navigation }: MaterialTopTabBarProps) {
  // The bar has its own label setting.
  const { p, radius, barLabels, accent, hueAt } = useTheme();
  const inset = useSafeAreaInsets();
  const showGlyph = barLabels !== "text";
  const showWord = barLabels !== "glyph";

  return (
    <View>
      {/* The app's ground under the bar, or Android's near-white window
          background shows through around it. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.background }]} />
      <View
        style={[
          styles.bar,
          {
            backgroundColor: p.surface2,
            borderRadius: radius.control,
            // Clear of the gesture bar, with a floor for phones with buttons.
            marginBottom: Math.max(inset.bottom, space.sm),
          },
        ]}
      >
        <View style={styles.well}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key]!;
            const label = options.title ?? route.name;
            const on = state.index === index;
            // Each tab takes a palette position; without the rainbow, the accent.
            const fill = hueAt(index) ?? accent;
            const ink = on ? contrastOn(fill) : p.textSub;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={on ? { selected: true } : {}}
                accessibilityLabel={label}
                onPress={() => {
                  const event = navigation.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!event.defaultPrevented) navigation.navigate(route.name);
                }}
                android_ripple={{ color: p.hover }}
                style={[
                  styles.segment,
                  {
                    borderRadius: radius.control,
                    backgroundColor: on ? fill : "transparent",
                  },
                ]}
              >
                {showGlyph ? <Glyph name={markFor(route.name)} color={ink} size={20} /> : null}
                {showWord ? (
                  <Text
                    numberOfLines={1}
                    // Shrinks rather than truncates, like the horizontal selector.
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={[styles.tabText, { color: ink }]}
                  >
                    {label}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/** The first screen of each tab's stack. */
const TAB_ROOT: Record<string, string> = {
  OverviewTab: "OverviewHome",
  JobsTab: "JobList",
  TargetsTab: "TargetList",
  HistoryTab: "RunList",
  SettingsTab: "SettingsHome",
};

/**
 * Reports whether a tab's stack has moved off its first screen. A tab whose
 * stack has not rendered yet reports no focused route and counts as at root.
 */
function deeperThanRoot(route: RouteProp<ParamListBase>): boolean {
  const focused = getFocusedRouteNameFromRoute(route);
  return focused !== undefined && focused !== TAB_ROOT[route.name];
}

/** A tab's glyph, the same marks the desktop rail uses. */
function markFor(route: string): string {
  return (
    {
      OverviewTab: "IconLive",
      JobsTab: "IconJobs",
      TargetsTab: "IconTargets",
      HistoryTab: "IconHistory",
      SettingsTab: "IconSettings",
    }[route] ?? "IconJobs"
  );
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
  const { p, radius } = useTheme();
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
            { color: p.textSub, backgroundColor: p.surface, borderRadius: radius.card },
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
  log: { fontFamily: "monospace", fontSize: text.caption, padding: space.md },

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
  tabText: { fontSize: text.caption, fontWeight: "500" },
});
