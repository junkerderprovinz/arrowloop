const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

/**
 * Metro has to see web/ as well as mobile/.
 *
 * The translations and the accent presets are imported from `../web/src`,
 * because one table of forty-two languages is one table - a second copy would
 * be the same work twice and would disagree with the container the first time
 * either was touched. Metro only watches the project root by default, so a
 * file outside it resolves at typecheck time and fails at bundle time, which
 * is the worst order to find out in.
 */
const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, "..");

config.watchFolders = [path.join(root, "web", "src")];
// node_modules stays this project's own. The web app has its own tree with a
// different React in it, and resolving a second copy of React is how a
// React Native app ends up with two renderers and an unhelpful hook error.
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];

module.exports = config;
