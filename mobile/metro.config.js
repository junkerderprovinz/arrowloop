const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// The translations and accent presets are shared with the web app and
// imported from ../web/src, which Metro does not watch by default.
const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, "..");

config.watchFolders = [path.join(root, "web", "src")];
// Resolving the web app's copy of React would give the bundle two renderers.
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];

module.exports = config;
