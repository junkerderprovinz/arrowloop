import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
import { loadAppearance } from "./src/settings";
import { space, text } from "./src/theme";
import { Body, Button, Heading, Screen, useTheme } from "./src/ui";
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
  const { p, scheme, radius } = useTheme();
  const { t } = useT();
  const { state, log, retry } = useEngine();

  // Navigation's own theme, so the chrome it draws - the bar, the header, the
  // ripple - uses GlimStone's colours rather than its defaults. Skipping this
  // is what makes a React Native app look like a React Native app.
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: p.accent,
      background: p.background,
      card: p.surface,
      text: p.text,
      border: p.border,
      notification: p.accent,
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

  if (state !== "ready") return <Waiting state={state} log={log} onRetry={retry} />;

  return (
    <>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <NavigationContainer theme={navTheme}>
        <Tabs.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: p.surface,
              borderTopColor: p.border,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
            },
            tabBarActiveTintColor: p.accent,
            tabBarInactiveTintColor: p.textMuted,
            tabBarLabelStyle: { fontSize: text.caption },
          }}
        >
          <Tabs.Screen
            name="JobsTab"
            options={{ title: t("nav.jobs"), tabBarIcon: () => <Glyph>⇄</Glyph> }}
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
            options={{ title: t("nav.targets"), tabBarIcon: () => <Glyph>☁</Glyph> }}
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
            options={{ title: t("nav.history"), tabBarIcon: () => <Glyph>≡</Glyph> }}
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
            options={{ title: t("nav.settings"), tabBarIcon: () => <Glyph>⚙</Glyph> }}
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

/** A tab's symbol. Text rather than an icon font, because four symbols do not
 *  justify a dependency and these four exist in every system face. */
function Glyph({ children }: { children: string }) {
  const { p } = useTheme();
  return <Text style={{ color: p.textMuted, fontSize: 18 }}>{children}</Text>;
}

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
        <Button label={t("phone.engineStart")} glyph="↻" tone="accent" onPress={onRetry} />
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
});
