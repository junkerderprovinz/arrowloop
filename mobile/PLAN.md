# The mobile app: what was decided, and what carries over

Decided 2026-09-11. jdp, looking at the app on his phone: *"das ist einfach das
normale program in einem fenster. das soll nicht so sein. Die App soll eine
native App sein mit an die mobilgeräte zugeschnittetnes UI. wie in der KL
App."* Offered the two routes with their costs, chose **React Native**.

## The thing that changed the question

The engine RUNS on his phone. That had been the open risk for days and it is
settled by his own sentence: *"auf dem handy läuft die app. sonst hätte ich es
ja nicht sehen können."* The WebView only ever loads once `Engine.answers()`
returns true - before that the screen says the engine is starting, and after
sixty seconds it shows the log. So seeing the interface at all means the arm64
engine answered on real hardware.

Everything the emulator had to say about this was about the emulator: its
x86_64 build dies on a syscall Android forbids, its arm64 build dies because
`ndk_translation` cannot exec an arm64 Go binary - proven with a two-line Go
program that does nothing but print.

## What this app is, and how it differs from KnightLoader's

KnightLoader's mobile app is a **companion**: it runs no engine and talks to a
server somewhere else, the way My.JDownloader's app is a client of a
JDownloader rather than a second one.

ArrowLoop's is not that. The engine runs **on the phone**, because the whole
point on a phone is syncing the phone's own files - photos, downloads,
documents. So the app both **hosts** the engine and **talks to** it, over
loopback.

That difference decides the shape:

- The React Native screens speak to `http://127.0.0.1:8422` - the same REST and
  event API the web interface uses. No second API, no bridge.
- Starting, stopping and supervising the engine stays in Kotlin, exposed to
  JavaScript as a native module.

## What carries over unchanged

None of the hard-won Android work is thrown away. It moves behind a native
module and keeps every comment explaining why it is the way it is:

- **`Engine.kt`** - the engine as its own POSIX process, why it ships as
  `libarrowloop.so` (since Android 10 an app may not exec out of its data
  directory, and only `lib*.so` reaches the native library directory), the
  diagnostics that write into the log the screen shows rather than into logcat,
  and the watcher that reports an exit code with the signal behind it.
- **`EngineService.kt`** - the `dataSync` foreground service, the six-hour
  daily cap that arrived in Android 14 and the timeout that arrived in 15.
- **`Storage.kt`** - `MANAGE_EXTERNAL_STORAGE` and the whole reasoning for it:
  SAF cannot set a modification time, and a separate POSIX process cannot reach
  SAF at all.
- **`android/debug.keystore`** - one stable debug key, so a build installs over
  the previous one instead of being refused as a different app.
- **The adaptive launcher icon** - a white tile with rounded corners, matching
  the KL app.

## What has to be built

The interface, and it is not a small list, which is why the cost was put in
front of the decision: jobs and their editor, the schedule builder, the
conflict view, targets across 55 providers, history with its filters, and
settings across three tabs. Each in 42 languages.

**One thing must not be rebuilt: the design language.** GlimStone's tokens are
the same colours and the same rules on a phone as anywhere else, and the app
must read as ArrowLoop rather than as a second product that happens to share a
name.

## Structure, following KnightLoader

`mobile/` holds the Expo project, exactly as KnightLoader's does, so the two
repos stay recognisable to each other. That includes its versioning rule: the
app carries its own version in `app.json` and is tagged on its own, because an
APK on a phone does not change when a container is pulled - and `versionCode`
must rise with every build handed to anybody, or the phone cannot tell two
builds apart.
