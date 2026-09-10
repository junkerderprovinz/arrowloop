# ArrowLoop for Android

A real mobile app, not the desktop interface in a window. React Native, native
screens, and the engine running beside them on the phone.

## Why this and not a WebView

There was a WebView shell before this. jdp, looking at it on his phone: *"das
ist einfach das normale program in einem fenster. das soll nicht so sein. Die
App soll eine native App sein mit an die mobilgeräte zugeschnittetnes UI."*

He was right, and the number says so: the web interface carries **ten**
responsive classes in the entire application. On a phone it is exactly what he
called it. Both routes were put to him with their costs - one interface with a
phone layout, or a second interface built and then maintained twice - and he
chose React Native on 2026-09-11.

## How this differs from KnightLoader's app, which is not a detail

KnightLoader's mobile app is a **companion**: it runs no engine and talks to a
server somewhere else, the way My.JDownloader's app is a client of a
JDownloader rather than a second one.

This one **hosts** the engine. Syncing a phone's own photos is the point of
being on a phone at all, so the engine runs here, and the screens talk to it on
`127.0.0.1:8422` - the same REST API the web interface uses, and deliberately
not a second one. Starting and supervising that process stays in Kotlin,
because none of it is expressible in JavaScript.

## The shape

```
App.tsx            three tabs, and the waiting screen before the engine answers
src/api.ts         the engine's REST API and its event stream
src/engine.ts      the bridge to Kotlin: start, stop, log, storage
src/theme.ts       GlimStone's colours, copied from web/src/tokens.css
src/ui.tsx         the four primitives every screen is built from
src/useEngine.ts   starting the engine and knowing when it answers
src/screens/       Jobs, History, Settings
native/            the Kotlin the plugin copies into the generated project
plugins/           what turns a stock Expo project into this one
```

**Three tabs, and the count is the design.** The desktop has jobs, targets,
history and settings across three sub-tabs, because a desk is where a sync is
BUILT. A phone is where it is watched: is it running, did it work, does it have
the access it needs. Everything else would be a form nobody wants to fill in
with a thumb.

## android/ is generated, never committed

`expo prebuild` writes it from `app.json` and the plugins, so nothing in it can
be a hand edit - that would be gone the next time anybody ran `--clean`.
`plugins/withEngine.js` is the version of those edits which survives, and it
applies the same way on a laptop as in CI instead of living in one workflow's
sed. It does five things, each with its reason written beside it: the Kotlin
sources and their resources, registering the package, the service and the
loopback exception, the packaging that lets a 79 MB binary be EXECUTED rather
than loaded, and one stable signing key.

## Building it

```
cd mobile
npm ci
npx expo prebuild --platform android --clean
# the engine, into mobile/android/app/src/main/jniLibs/<abi>/libarrowloop.so
cd android && ./gradlew assembleRelease
```

**Release, not debug.** A React Native debug build expects Metro to hand it the
JavaScript at runtime; installed on a phone with no Metro it shows a red screen
saying "Unable to load script". The release build packages the bundle into the
APK, which is what makes it a program somebody can be given. `.github/workflows/
mobile.yml` does all of this.

## Signing

The debug key at `../android/debug.keystore`, pointed at by the plugin. Stable
across builds, which is what makes an update an update: Gradle otherwise signs
with whatever debug keystore it finds in the builder's home directory and
creates one if there is none, so every CI build carried a different key - and
to Android a different signing key is a different app. Every update refused
with `INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match`, which the
phone reports as "conflicts with an existing package".

It is public, and therefore fit for installing on your own devices and nothing
else. A real key belongs in a repository secret, never here.

## What the emulator can and cannot tell you

[[StrawKnight]] runs the app itself perfectly well - the screens, the bridge,
the log. What it cannot do is run the ENGINE, in either architecture and for
two unrelated reasons:

- The **x86_64** engine dies with `SIGSYS`. `modernc.org/sqlite` opens its
  database, calls `lstat`, and `modernc.org/libc` issues that as raw syscall 6
  on amd64 - which Android's seccomp filter forbids, because bionic has never
  used the legacy stat calls. arm64 cannot hit this: those syscalls do not
  exist there at all.
- The **arm64** engine dies with `SIGSEGV` inside `ndk_translation`, which
  covers code the Android runtime loads rather than an arm64 ELF a process
  execs for itself. Proven with a two-line Go program that does nothing but
  print: same signal.

So a phone is the only place the engine can be judged, and it works there.
