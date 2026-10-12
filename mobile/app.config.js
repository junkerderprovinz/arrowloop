// ARROWLOOP_SIDE_BY_SIDE=1 builds a test copy that installs next to the
// released app on the same phone. It changes everything two installed copies
// could fight over: the application id, the launcher name and icon, the link
// scheme and the engine's loopback port. app.json stays the released app, since
// F-Droid and the release workflow read it.
//
// The variable has to be set for `expo prebuild` and again for Gradle, which
// embeds this config for the JavaScript side; plugins/withEngine.js makes
// Gradle refuse a build where the two disagree.

module.exports = ({ config }) => {
  const sideBySide = process.env.ARROWLOOP_SIDE_BY_SIDE === "1";
  if (!sideBySide) {
    return { ...config, extra: { ...config.extra, sideBySide, enginePort: 8422 } };
  }
  return {
    ...config,
    name: "ArrowLoop Test",
    scheme: "arrowloop-test",
    android: {
      ...config.android,
      adaptiveIcon: { ...config.android.adaptiveIcon, backgroundColor: "#1f2937" },
    },
    extra: { ...config.extra, sideBySide, enginePort: 8423 },
  };
};
