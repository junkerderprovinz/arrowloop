const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withMainApplication,
  AndroidConfig,
} = require("expo/config-plugins");

// Applies what the engine needs to the Android project that `expo prebuild`
// generates and that is not committed: the Kotlin sources and resources, the
// package registration, the manifest entries, uncompressed packaging for the
// engine binary, and the signing keys.

const PACKAGE = "design.halleluja.arrowloop";

/**
 * The engine's filename. Android 10 and later only execute files from the
 * native library directory, which only takes files named like a library.
 */
const ENGINE = "libarrowloop.so";

/** Copies the native sources, resources and engine binary into the generated project. */
function withNativeSources(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const from = path.join(cfg.modRequest.projectRoot, "native");

      const java = path.join(root, "app", "src", "main", "java", ...PACKAGE.split("."));
      fs.mkdirSync(java, { recursive: true });
      const src = path.join(from, "java", ...PACKAGE.split("."));
      for (const file of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, file), path.join(java, file));
      }

      // The notification icon and strings EngineService uses.
      const res = path.join(root, "app", "src", "main", "res");
      copyTree(path.join(from, "res"), res);

      // The engine binary is gitignored and comes from `go build` or a CI
      // artefact. Gradle packages an empty jniLibs without complaint, so a
      // missing engine has to fail here.
      const engines = path.join(from, "jniLibs");
      const abis = fs.existsSync(engines)
        ? fs
            .readdirSync(engines, { withFileTypes: true })
            .filter((e) => e.isDirectory() && fs.existsSync(path.join(engines, e.name, ENGINE)))
            .map((e) => e.name)
        : [];
      if (abis.length === 0) {
        throw new Error(
          `withEngine: no ${ENGINE} under mobile/native/jniLibs, so the APK would hang on its start screen without an engine. Build one into mobile/native/jniLibs/<abi>/${ENGINE}, or take the one from a Mobile CI run.`,
        );
      }
      // A stale binary loads fine and silently lacks the latest Go changes, so
      // it is compared against the newest .go file anywhere in the repository.
      const built = newestGo(path.join(root, "..", ".."));
      for (const abi of abis) {
        const source = path.join(engines, abi, ENGINE);
        if (built && fs.statSync(source).mtimeMs < built.at) {
          throw new Error(
            `withEngine: mobile/native/jniLibs/${abi}/${ENGINE} is older than ${built.file}. ` +
              `The APK would run an engine from before that change. Rebuild it with\n` +
              `  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o mobile/native/jniLibs/${abi}/${ENGINE} ./cmd/arrowloop\n` +
              `(GOARCH=amd64 for x86_64), or take the one from a Mobile CI run.`,
          );
        }
        const target = path.join(root, "app", "src", "main", "jniLibs", abi);
        fs.mkdirSync(target, { recursive: true });
        fs.copyFileSync(source, path.join(target, ENGINE));
      }
      return cfg;
    },
  ]);
}

/**
 * Returns the most recently changed .go file under root, skipping trees a build
 * never reads. An unreadable tree yields null rather than failing the build.
 */
function newestGo(root) {
  const skip = new Set(["node_modules", "android", "vendor", ".git", "dist", "build"]);
  let best = null;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".go")) {
        const at = fs.statSync(full).mtimeMs;
        if (!best || at > best.at) best = { at, file: path.relative(root, full) };
      }
    }
  };
  walk(root);
  return best;
}

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

/** Registers EnginePackage, without which the module is undefined at runtime. */
function withPackageRegistered(config) {
  return withMainApplication(config, (cfg) => {
    const marker = "add(EnginePackage())";
    if (cfg.modResults.contents.includes(marker)) return cfg;
    // Packages that cannot be autolinked go in the template's
    // `PackageList(this).packages.apply { }` lambda.
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /(PackageList\(this\)\.packages\.apply\s*\{)/,
      `$1\n          ${marker}`,
    );
    if (!cfg.modResults.contents.includes(marker)) {
      throw new Error(
        "withEngine: could not find the package list in MainApplication; the Expo template changed shape, and without it NativeModules.ArrowLoopEngine is undefined at runtime",
      );
    }
    return cfg;
  });
}

/** Adds the services and the boot receiver, and allows cleartext to loopback only. */
function withEngineManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    app.service = app.service ?? [];
    if (!app.service.some((s) => s.$["android:name"] === ".EngineService")) {
      app.service.push({
        $: {
          "android:name": ".EngineService",
          "android:exported": "false",
          // dataSync is capped at six hours a day since Android 14.
          "android:foregroundServiceType": "dataSync",
        },
      });
    }

    // Without BIND_JOB_SERVICE, JobScheduler.schedule fails silently and the
    // phone never syncs on its own.
    if (!app.service.some((s) => s.$["android:name"] === ".SyncJobService")) {
      app.service.push({
        $: {
          "android:name": ".SyncJobService",
          "android:exported": "false",
          "android:permission": "android.permission.BIND_JOB_SERVICE",
        },
      });
    }

    app.receiver = app.receiver ?? [];
    if (!app.receiver.some((r) => r.$["android:name"] === ".BootReceiver")) {
      app.receiver.push({
        $: { "android:name": ".BootReceiver", "android:exported": "true", "android:enabled": "true" },
        "intent-filter": [{ action: [{ $: { "android:name": "android.intent.action.BOOT_COMPLETED" } }] }],
      });
    }

    // expo-build-properties sets usesCleartextTraffic, which would allow plain
    // HTTP to any server; the network security config narrows it to loopback.
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return cfg;
  });
}

function withNetworkConfig(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by plugins/withEngine.js; android/ is regenerated, so do not edit.
     Plain HTTP is allowed only to the engine on loopback. -->
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`,
        "utf8",
      );
      return cfg;
    },
  ]);
}

/**
 * Adds build-time checks, ABI splits and the signing keys to the app's
 * build.gradle. The debug key is the repository's android/debug.keystore, so
 * every build carries the same key and installs over the previous one.
 */
function withEngineGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    // The native sources are copied again whenever Gradle configures, so a
    // build without a fresh prebuild cannot compile a stale copy. Copying at
    // configuration time rather than in a task avoids the undeclared-output
    // errors Gradle 9 raises for tasks writing into src/main/res. The block is
    // replaced on every pass so existing trees pick up changes to it.
    const SYNC = "// arrowloop: the native sources cannot go stale";
    const SYNC_END = "// arrowloop: end of the native-sources block";
    {
      const from = gradle.indexOf(SYNC);
      const to = gradle.indexOf(SYNC_END);
      if (from !== -1 && to !== -1) {
        gradle = gradle.slice(0, from) + gradle.slice(to + SYNC_END.length);
      } else if (from !== -1) {
        // A block without an end marker runs to the end of the file.
        gradle = gradle.slice(0, from);
      }
      gradle += `
${SYNC}
copy {
    from rootProject.file('../native/java')
    into file('src/main/java')
}
copy {
    from rootProject.file('../native/res')
    into file('src/main/res')
}
copy {
    from rootProject.file('../native/jniLibs')
    into file('src/main/jniLibs')
}

// Fails on an engine older than the Go sources. The prebuild step checks the
// same, but a plain \`./gradlew assembleRelease\` skips prebuild.
tasks.matching { it.name ==~ /^(merge|package).*[Nn]ativeLibs\$/ || it.name ==~ /^package(Debug|Release)\$/ }.configureEach {
    doFirst {
        def repo = rootProject.file('../..')
        def newest = null
        repo.traverse(
            type: groovy.io.FileType.FILES,
            preDir: { d -> d.name in ['node_modules', 'android', 'vendor', 'dist', 'build'] || d.name.startsWith('.') ? groovy.io.FileVisitResult.SKIP_SUBTREE : groovy.io.FileVisitResult.CONTINUE }
        ) { f ->
            if (f.name.endsWith('.go') && (newest == null || f.lastModified() > newest.lastModified())) {
                newest = f
            }
        }
        if (newest != null) {
            // The source tree, since the copy in src/main/jniLibs carries the
            // time it was copied.
            fileTree(rootProject.file('../native/jniLibs')).matching { include '**/libarrowloop.so' }.each { so ->
                if (so.lastModified() < newest.lastModified()) {
                    throw new GradleException(
                        so.absolutePath + ' is older than ' + newest.absolutePath + '. ' +
                        'The APK would run an engine from before that change. Rebuild it with\\n' +
                        '  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o mobile/native/jniLibs/arm64-v8a/libarrowloop.so ./cmd/arrowloop\\n' +
                        '(GOARCH=amd64 into x86_64), or take the one from a Mobile CI run.')
                }
            }
        }
    }
}

// Fails when there is no engine to package: the binary is gitignored, and
// Gradle packages an empty jniLibs without complaint.
tasks.matching { it.name ==~ /^(merge|package).*[Nn]ativeLibs\$/ || it.name ==~ /^package(Debug|Release)\$/ }.configureEach {
    doFirst {
        def dir = file('src/main/jniLibs')
        def found = dir.exists() ? fileTree(dir).matching { include '**/libarrowloop.so' }.files : []
        if (found.isEmpty()) {
            throw new GradleException(
                'no libarrowloop.so under mobile/native/jniLibs, so this build would produce an APK with no engine in it. ' +
                'Build one into mobile/native/jniLibs/<abi>/libarrowloop.so, or take the one from a Mobile CI run.')
        }
    }
}

// The bundle imports from ../../web/src (see metro.config.js), which the
// bundling task's up-to-date check would otherwise ignore.
tasks.matching { it.name ==~ /^createBundle.*JsAndAssets\$/ }.configureEach {
    inputs.dir(rootProject.file('../../web/src'))
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName('arrowloopSharedSources')
}
${SYNC_END}
`;
    }

    // One APK per architecture, inserted before `defaultConfig {`, which every
    // version of the template has.
    const SPLITS = "// arrowloop: one APK per architecture";
    if (!gradle.includes(SPLITS)) {
      gradle = gradle.replace(
        /(\n\s*defaultConfig\s*\{)/,
        `
    splits {
        abi {
            ${SPLITS}
            enable true
            reset()
            // arm64 for phones, x86_64 for emulators. The engine is 79 MB per
            // architecture, so 32-bit ARM and a universal APK are left out.
            include "arm64-v8a", "x86_64"
            universalApk false
        }
    }
$1`,
      );
      if (!gradle.includes(SPLITS)) {
        throw new Error("withEngine: could not find defaultConfig to put the ABI splits before");
      }
    }

    // The repository's debug key rather than the Expo template's, so this app
    // installs over the earlier Android shell signed with it.
    const KEY = "arrowloop/android/debug.keystore";
    if (!gradle.includes(KEY)) {
      const before = gradle;
      gradle = gradle.replace(
        /storeFile file\('debug\.keystore'\)/,
        // Relative to android/app: up to mobile/, up to the repository root.
        "storeFile file('../../../android/debug.keystore') // " + KEY,
      );
      if (gradle === before) {
        throw new Error("withEngine: could not find the debug signing config to repoint");
      }
    }

    // Published APKs are signed with a release key from the environment, since
    // anybody could sign an update with the public debug key:
    //
    //   ARROWLOOP_ANDROID_KEYSTORE        path to the keystore
    //   ARROWLOOP_ANDROID_STORE_PASSWORD  its password
    //   ARROWLOOP_ANDROID_KEY_ALIAS       the key inside it
    //   ARROWLOOP_ANDROID_KEY_PASSWORD    that key's password
    //
    // Unset, a release build signs with the debug key so a local build needs
    // no secrets; mobile.yml refuses a signed build without them.
    const RELEASE_KEY = "// arrowloop: release signing from the environment";
    if (!gradle.includes(RELEASE_KEY)) {
      const before = gradle;
      gradle = gradle.replace(
        /(\n\s*signingConfigs\s*\{)/,
        `$1
        release {
            ${RELEASE_KEY}
            // Groovy truth, since the workflow passes an empty string when
            // not signing.
            def ks = System.getenv('ARROWLOOP_ANDROID_KEYSTORE')
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv('ARROWLOOP_ANDROID_STORE_PASSWORD')
                keyAlias System.getenv('ARROWLOOP_ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ARROWLOOP_ANDROID_KEY_PASSWORD')
                // v3 supports key rotation; with minSdk 26 nothing reads v1.
                enableV2Signing true
                enableV3Signing true
            }
        }`,
      );
      const releaseType = /(\n\s*release\s*\{\s*\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/;
      gradle = gradle.replace(
        releaseType,
        "$1signingConfig System.getenv('ARROWLOOP_ANDROID_KEYSTORE') ? signingConfigs.release : signingConfigs.debug",
      );
      if (gradle === before || !gradle.includes(RELEASE_KEY) || !gradle.includes("? signingConfigs.release : signingConfigs.debug")) {
        // Both edits or neither.
        throw new Error("withEngine: could not find signingConfigs and the release buildType's debug signing; the Expo template changed");
      }
    }

    cfg.modResults.contents = gradle;
    return cfg;
  });
}

/**
 * Packs the engine uncompressed, so it is extracted as a real file that can be
 * executed. The template reads this from a Gradle property.
 */
function withLegacyPackaging(config) {
  return withGradleProperties(config, (cfg) => {
    const key = "expo.useLegacyPackaging";
    cfg.modResults = cfg.modResults.filter((item) => !("key" in item && item.key === key));
    cfg.modResults.push({
      type: "comment",
      value:
        " Set by plugins/withEngine.js. The engine ships as libarrowloop.so in the native library directory, the only place Android 10 and later execute files from, and it can only be executed there uncompressed.",
    });
    cfg.modResults.push({ type: "property", key, value: "true" });
    return cfg;
  });
}

module.exports = function withEngine(config) {
  config = withNativeSources(config);
  config = withPackageRegistered(config);
  config = withEngineManifest(config);
  config = withNetworkConfig(config);
  config = withEngineGradle(config);
  config = withLegacyPackaging(config);
  return config;
};
