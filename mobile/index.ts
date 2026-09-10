import { registerRootComponent } from "expo";
import App from "./App";

// registerRootComponent rather than AppRegistry: it does the same thing and
// also sets the environment up for `expo start` on a laptop, so one entry
// point serves both a development run and a built APK.
registerRootComponent(App);
