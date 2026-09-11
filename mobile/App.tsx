import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { I18nProvider, useT } from "./src/i18n";
import type { HistoryStack, JobsStack, SettingsStack, TargetsStack } from "./src/nav";
import { History } from "./src/screens/History";
import { JobDetail } from "./src/screens/JobDetail";
import { JobEdit } from "./src/screens/JobEdit";
import { Jobs } from "./src/screens/Jobs";
import { Language } from "./src/screens/Language";
import { Plan } from "./src/screens/Plan";
import { RunDetail } from "./src/screens/RunDetail";
import { Settings } from "./src/screens/Settings";
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

/**
 * ArrowLoop on a phone.
 *
 * FOUR tabs, the same four the desktop has, because they are the same four
 * questions: what is set up, where it syncs to, what happened, and how it
 * behaves. What differs is the depth behind each - a desk is where a sync is
 * built and a phone is where it is watched, so the list is one tap from a
 * detail rather than a table with every column visible at once.
 *
 * A stack PER TAB rather than one across the app, which is what makes the back
 * gesture do the obvious thing: leaving a job's detail returns to the job list
 * and not to whatever was open in another tab. Android's back button is a
 * promise about where you came from, and a single stack breaks it the first
 * time somebody switches tabs mid-task.
 *
 * A bottom bar rather than the desktop's rail: a rail is reachable with a
 * mouse and a bar is reachable with a thumb, which is that whole difference in
 * one control.
 */
const Tabs = createBottomTabNavigator();
const JobsNav = createNativeStackNavigator<JobsStack>();
const HistoryNav = createNativeStackNavigator<HistoryStack>();
const TargetsNav = createNativeStackNavigator<TargetsStack>();
const SettingsNav = createNativeStackNavigator<SettingsStack>();

export default function App() {
  // Read BEFORE the first paint, so nothing flashes in the wrong accent. A
  // theme that arrives a frame late is the tell of an app assembled rather
  // than designed.
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
  const { state, log, retry } = useEngine();
  const look = useAppearance();

  /**
   * The lock, if this install asked for one.
   *
   * It gates the whole app rather than the settings alone, which is the plain
   * reading of "die app sperren": somebody who can see the job list can see
   * every path this phone syncs and can start a run. Half a lock is the kind
   * that surprises people.
   *
   * Locked again after a MINUTE in the background rather than instantly. An app
   * that asks for the phone's PIN every time somebody glances at a message is
   * an app people switch the lock back off in, and a minute is short enough
   * that a phone handed to somebody else is still locked.
   */
  const [locked, setLocked] = useState(look.lock);
  const left = useRef(0);

  const unlock = useCallback(() => {
    engine
      .confirmDeviceLock(t("settings.locked"), t("settings.lockHint"))
      .then((ok) => ok && setLocked(false))
      .catch(() => {});
  }, [t]);

  useEffect(() => {
    // A lock switched on in the settings must not lock the screen it was
    // switched on from; it takes effect the next time the app is left.
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

  // Asked as soon as the app comes up locked, so the first thing on screen is
  // the phone's own dialog rather than a wall with a button on it.
  useEffect(() => {
    if (locked) unlock();
  }, [locked, unlock]);

  // Navigation's own theme, so the chrome it draws - the bar, the header, the
  // ripple - uses GlimStone's colours rather than its defaults. Skipping this
  // is what makes a React Native app look like a React Native app.
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

  // The notification permission, asked ONCE and automatically, the moment
  // there is an engine to be notified about. Android grants this one through a
  // real dialog with an Allow button, so there is no reason to make somebody go
  // looking for it in the settings first; the button on the settings screen is
  // for afterwards, when the answer was no and has become yes.
  //
  // Only when the engine is up, because the request opens a dialog over
  // whatever is on screen, and a dialog over a "starting the engine" message is
  // a dialog about something that has not happened yet.
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
          screenOptions={{
            headerShown: false,
            // The bar FLOATS as a card rather than being welded to the bottom
            // of the screen. jdp: "die untere leiste soll nicht am rand kleben
            // sondern aussehen wie die sidebar." The desktop rail made the same
            // move for the same reason: everything else on screen is a card on
            // a ground, and the one element that was neither read as belonging
            // to the system's chrome instead of to the app.
            //
            // The bar itself goes transparent and the card is drawn behind it,
            // which is what lets the card be INSET while the bar keeps the
            // height it reserves from the screen above. A bar given margins
            // directly moves the icons and leaves the reserved space where it
            // was, so the page ends in a gap and the icons sit in front of it.
            tabBarStyle: {
              backgroundColor: "transparent",
              // No line. GlimStone separates surfaces by shade, and there is
              // nothing to separate here anyway once the bar is a card.
              borderTopWidth: 0,
              elevation: 0,
            },
          }}
          // The bar is drawn HERE rather than configured, because three of the
          // things asked of it are not options react-navigation has: the label
          // engine, a filled pill under the current tab, and a glyph that is
          // centred over its own word rather than over the space a word would
          // take. See TabBar below.
          tabBar={(props) => <TabBar {...props} />}
        >
          <Tabs.Screen
            name="JobsTab"
            options={{ title: t("nav.jobs") }}
          >
            {() => (
              <JobsNav.Navigator screenOptions={header}>
                <JobsNav.Screen name="JobList" component={Jobs} options={{ title: t("jobs.title") }} />
                <JobsNav.Screen name="JobDetail" component={JobDetail} options={{ title: "" }} />
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
            name="TargetsTab"
            options={{ title: t("nav.targets") }}
          >
            {() => (
              <TargetsNav.Navigator screenOptions={header}>
                <TargetsNav.Screen
                  name="TargetList"
                  component={Targets}
                  options={{ title: t("targets.cloud") }}
                />
                <TargetsNav.Screen
                  name="TargetPick"
                  component={TargetPick}
                  options={{ title: t("targets.addStorage") }}
                />
                <TargetsNav.Screen
                  name="TargetEdit"
                  component={TargetEdit}
                  options={{ title: t("targets.edit") }}
                />
              </TargetsNav.Navigator>
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
              </SettingsNav.Navigator>
            )}
          </Tabs.Screen>
        </Tabs.Navigator>
      </NavigationContainer>
    </>
  );
}

/**
 * The bottom bar, drawn here rather than configured.
 *
 * Three things were asked of it that react-navigation's own bar cannot do, and
 * each of them is the same kind of thing - the bar was the one surface in the
 * app that had opted out of the house rules:
 *
 *  - IT ANSWERS THE LABEL ENGINE. Every other control in the product shows
 *    text, text and symbol, or symbol alone according to one setting, and the
 *    bar showed both whatever anybody chose. jdp: "Die bottombar ist nicht in
 *    der beschriftungsengine."
 *  - THE CURRENT TAB IS A BUTTON. It was a word in the accent colour, which is
 *    how a link looks; everywhere else in this language what is selected is
 *    FILLED. Autosync's own bar does the same thing, and the difference is
 *    visible from across a room.
 *  - THE GLYPH SITS OVER ITS OWN WORD. The stock bar reserves label height
 *    whether or not there is a label, so in symbol mode the marks hung above
 *    an empty strip, and with words they sat slightly high. jdp: "die glyphen
 *    mit text sind auch nicht vertikal zentriert."
 *
 * The card behind it is unchanged and keeps its own long comment: the bar
 * FLOATS, inset from every edge, and paints the app's own ground underneath
 * because Android's window background is near-white and showed through.
 */
function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { p, radius, labels, accent, hueAt } = useTheme();
  const inset = useSafeAreaInsets();
  const showGlyph = labels !== "text";
  const showWord = labels !== "glyph";

  return (
    <View>
      {/* The app's own ground, edge to edge, UNDER the card.
          Android's window background measured #fafafa on a page of #161616, so
          a floating card sat in a near-white band the width of the screen. jdp:
          "hinter der bottombar ist ein weißer hintergrund." An app that paints
          its own ground everywhere else must paint it here too. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.background }]} />
      <View
        style={[
          styles.bar,
          {
            backgroundColor: p.surface,
            borderRadius: radius.card,
            // The gesture bar lives below this. `space.sm` is the floor, for a
            // phone with buttons instead, where the inset is zero and a card
            // flush with the bottom edge is exactly what this is fixing.
            marginBottom: Math.max(inset.bottom, space.sm),
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key]!;
          const label = options.title ?? route.name;
          const on = state.index === index;
          // Each tab owns a palette position, because they are members of one
          // set the way a card's rows are. Off, every one of them is the accent
          // - which is what the app looks like unless somebody asked for more.
          const fill = hueAt(index) ?? accent;
          const ink = on ? contrastOn(fill) : p.textMuted;
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
                // A second press on the tab you are already on pops its stack,
                // which is what every other app on the phone does.
                if (!on && !event.defaultPrevented) navigation.navigate(route.name);
                else if (on && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              android_ripple={{ color: p.hover, borderless: false }}
              style={styles.slot}
            >
              {/* THE PILL is the selected state, and it wraps only what is
                  actually shown: in symbol mode it is a round badge around one
                  mark, with words it is a capsule around both. A pill sized for
                  a label that is not being drawn is a pill with a hole in it. */}
              <View
                style={[
                  styles.pill,
                  {
                    borderRadius: radius.pill,
                    backgroundColor: on ? fill : "transparent",
                    // With words the pill takes the whole slot, so the longest
                    // label has every pixel the bar can give it - "Einstellungen"
                    // came out as "Einstellung..." when the pill was only as
                    // wide as its content plus padding. With symbols alone it
                    // stays a round badge around one mark, because a slot-wide
                    // pill around a 20px glyph is a bar, not a button.
                    alignSelf: showWord ? "stretch" : "center",
                    paddingHorizontal: showWord ? space.xs : space.sm,
                  },
                ]}
              >
                {showGlyph ? <Glyph name={markFor(route.name)} color={ink} size={20} /> : null}
                {showWord ? (
                  <Text numberOfLines={1} style={[styles.tabText, { color: ink }]}>
                    {label}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A tab's symbol, from the app's OWN set.
 *
 * These four were `⇄ ☁ ≡ ⚙` - characters from whatever face the phone happens
 * to ship - while the rail they mirror on the desktop draws IconJobs,
 * IconTargets, IconHistory and IconSettings. jdp: "die glyphen auf der bottombar
 * passen nicht." They do not: a system font's arrows and gear are somebody
 * else's drawing at somebody else's weight, sitting under four labels in this
 * app's own type, and the cloud in particular renders as a colour emoji on
 * Android rather than as a mark at all.
 *
 * Keyed on the ROUTE rather than passed per screen, because the bar now draws
 * itself: the mark belongs to the tab, not to the options object.
 */
function markFor(route: string): string {
  return (
    {
      JobsTab: "IconJobs",
      TargetsTab: "IconTargets",
      HistoryTab: "IconHistory",
      SettingsTab: "IconSettings",
    }[route] ?? "IconJobs"
  );
}

/**
 * The wall in front of a locked app.
 *
 * It carries a button rather than only a sentence, because the system dialog
 * can be dismissed and then there has to be a way back to it. Nothing about
 * the app is visible behind it - not the job names, not the paths - which is
 * the whole point of the lock.
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

/** A minute away before the lock closes again. Instant would be an app people
 *  switch the lock back off in; a minute still locks a handed-over phone. */
const AWAY_MS = 60 * 1000;

/**
 * The screen before the engine answers, and the one after it does not.
 *
 * Two states in one component because they are the same moment: waiting, and
 * having waited long enough. What matters is that the second shows the
 * engine's own log - a person with a broken app deserves the reason rather
 * than a shrug, and on a phone there is no console to find it in.
 */
function Waiting({ state, log, onRetry }: { state: string; log: string; onRetry: () => void }) {
  const { p, radius } = useTheme();
  const { t } = useT();
  // The insets by hand, because this screen is OUTSIDE the navigator - the one
  // place nothing else is holding the status bar off the content. It showed:
  // the heading sat on top of the clock.
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

  // The floating bar: inset from every edge, so it reads as a card on the page
  // rather than as part of the phone's own chrome.
  bar: {
    flexDirection: "row",
    marginHorizontal: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    gap: space.xs,
  },
  // Each tab takes an equal share of the bar, and the PILL inside it is only as
  // wide as what it holds - so four tabs stay evenly spaced whether they are
  // showing words, symbols or both.
  slot: { flex: 1, alignItems: "center", justifyContent: "center" },
  pill: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    // The glyph sits directly over its own word rather than over the space a
    // word would occupy, which is what the stock bar could not do: it reserves
    // label height whether or not a label is drawn.
    gap: 2,
    paddingVertical: 5,
  },
  tabText: { fontSize: text.caption, fontWeight: "500" },
});
