import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { History } from "./src/screens/History";
import { Jobs } from "./src/screens/Jobs";
import { Settings } from "./src/screens/Settings";
import { palettes, space, text } from "./src/theme";
import { Body, Button, Heading, Screen, usePalette } from "./src/ui";
import { useEngine } from "./src/useEngine";

/**
 * ArrowLoop on a phone.
 *
 * THREE tabs, and the count is the design rather than a starting point. The
 * desktop has jobs, targets, history and settings across three sub-tabs,
 * because a desk is where a sync is BUILT. A phone is where it is watched: is
 * it running, did it work, and does it have the access it needs. Everything
 * else would be a form nobody wants to fill in with a thumb.
 *
 * A bottom bar rather than the desktop's rail: a rail is reachable with a
 * mouse and a bottom bar is reachable with a thumb, which is the whole
 * difference between the two interfaces in one control.
 */
const Tabs = createBottomTabNavigator();

export default function App() {
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const p = palettes[scheme];
  const { state, log, retry } = useEngine();

  // Navigation's own theme, so the chrome it draws - the bar, the header, the
  // ripple - uses GlimStone's colours rather than its defaults. Skipping this
  // is what makes a React Native app look like a React Native app.
  const navTheme = {
    ...(scheme === "light" ? DefaultTheme : DarkTheme),
    colors: {
      ...(scheme === "light" ? DefaultTheme : DarkTheme).colors,
      primary: p.accent,
      background: p.background,
      card: p.surface,
      text: p.text,
      border: p.border,
      notification: p.accent,
    },
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      {state === "ready" ? (
        <NavigationContainer theme={navTheme}>
          <Tabs.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: p.background },
              headerTitleStyle: { color: p.text, fontSize: text.title },
              headerShadowVisible: false,
              tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border },
              tabBarActiveTintColor: p.accent,
              tabBarInactiveTintColor: p.textMuted,
              tabBarLabelStyle: { fontSize: text.caption },
            }}
          >
            <Tabs.Screen name="Jobs" component={Jobs} />
            <Tabs.Screen name="History" component={History} />
            <Tabs.Screen name="Settings" component={Settings} />
          </Tabs.Navigator>
        </NavigationContainer>
      ) : (
        <Waiting state={state} log={log} onRetry={retry} />
      )}
    </SafeAreaProvider>
  );
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
  const p = usePalette();
  // The insets by hand, because this screen is OUTSIDE the navigator - the one
  // place nothing else is holding the status bar off the content. It showed:
  // the heading sat on top of the clock.
  const inset = useSafeAreaInsets();
  if (state === "starting") {
    return (
      <Screen>
        <View style={[styles.centre, { paddingTop: inset.top }]}>
          <Heading>Starting the engine…</Heading>
          <Body muted>
            It is a large program and a cold start takes a moment. It keeps running afterwards.
          </Body>
        </View>
      </Screen>
    );
  }
  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.trouble, { paddingTop: inset.top + space.lg }]}>
        <Heading>The engine did not answer</Heading>
        <Text style={[styles.log, { color: p.textSub, backgroundColor: p.surface }]}>{log}</Text>
        <Button label="Try again" tone="accent" onPress={onRetry} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm },
  trouble: { padding: space.lg, gap: space.md },
  log: {
    fontFamily: "monospace",
    fontSize: text.caption,
    padding: space.md,
    borderRadius: 8,
  },
});
