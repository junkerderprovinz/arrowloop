# ArrowLoop for Android

The same engine, on a phone. Not a rewrite: `libarrowloop.so` in this app is
byte for byte the binary the container runs, cross-compiled for the phone's
architecture, and the screen is the engine's own interface in a WebView.

## Why a process and a WebView

**One engine.** The sync algorithm, the state database, the three-way
comparison and the brakes are hard-won and already exist. A second
implementation in Kotlin would be a second thing to keep in step with the
first, which is how two versions of one program end up disagreeing about what a
job is.

**One interface.** ArrowLoop's screens are forty-two languages of a design
language that already exists. A phone-shaped rewrite would be the same problem
again, in a different file.

## The two things Android forces

**The binary ships as `libarrowloop.so`.** Since Android 10 an app may not
execute a file out of its own data directory - a binary copied to `filesDir`
fails with "Permission denied" whatever mode it carries. The one place left is
the native library directory, and only files matching `lib*.so` are put there.
It is a program, not a library; the name is what the packaging demands.

**The engine binds 127.0.0.1 and nothing else.** It has no login of its own: on
a home server it sits behind the network the server is on, and a phone has no
such boundary. On loopback it is reachable by this app and by nothing else, not
by another app without the INTERNET permission and never by anybody on the same
wifi.

## Building

    gradle assembleRelease

There is no Gradle wrapper in here on purpose: the build runs on a machine that
already has Gradle (the CI runner does), and a wrapper whose jar nobody checks
is a binary in the repository that every clone executes without reading.

The engine has to be there first. `.github/workflows/android.yml` builds it:

    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build \
      -o android/app/src/main/jniLibs/arm64-v8a/libarrowloop.so ./cmd/arrowloop

`CGO_ENABLED=0` is what makes this work without the NDK: everything the engine
needs is pure Go, and a static binary makes its own syscalls, so it runs on
Android's bionic exactly as it does on glibc.

Two architectures, one APK each. arm64 is every phone sold in the last decade;
x86_64 is what the emulator is, so the rig this was developed against installs
the same build. The engine is about 75 MB per architecture, which is rclone with
sixty-eight backends compiled in, and it is the whole of the download.

Two APKs come out per architecture, and the **debug** one is the one to install.

The release APK is **unsigned**: signing needs a keystore, and a workflow that
quietly signs with a throwaway key produces an app that installs once and can
never be updated, because every later build would be a different app as far as
Android is concerned. An unsigned APK cannot be installed at all, though, so a
job producing only that would be a green tick over something nobody can put on a
phone. The debug APK is signed with the standard debug key every Android SDK
carries. It installs, it runs, and it is honestly named: for trying the thing,
not for shipping it.

## What it can reach

Everything on the phone's storage, once **All files access** is granted. The app
asks for it on first launch with a screen explaining why, and the switch itself
lives on a system settings page rather than in a dialog.

This was going to be the Storage Access Framework, and it cannot be. Two reasons,
both from Android's own source rather than from trying it:

**SAF cannot set a modification time.** `DocumentsProvider.update()` is declared
`public final` and throws `UnsupportedOperationException`. No client can override
it and no client can call it usefully, and that is still true at API 36. A
two-way sync whose comparison rests on size and mtime has nothing to stand on
there.

**SAF is not reachable from the engine at all.** The engine is the same static
binary the container and the desktop run, started as its own POSIX process. SAF
lives behind Binder and the JVM: a child process has no `ContentResolver`, no JNI
environment and no way to obtain one. Syncthing hit exactly this. The way around
it is to bind the engine into the app process with gomobile, which means a second
build of the engine for one platform out of four, and it would still leave the
mtime unsolved.

So `MANAGE_EXTERNAL_STORAGE`. Google permits it for the category this app is in,
"Backup and restore apps", and a Play listing has to declare and justify it;
FolderSync ships the same way. `Storage.kt` carries the full reasoning.

**Android 10 is a genuine gap.** `MANAGE_EXTERNAL_STORAGE` arrived in 11, and the
`requestLegacyExternalStorage` escape is ignored for an app targeting above 29,
which this one must. On Android 10 the app runs and syncs its own private folder
and nothing else. The panel says so rather than offering a button that would do
nothing. Below 10, `WRITE_EXTERNAL_STORAGE` grants the same reach as an ordinary
runtime permission and is asked for the ordinary way.
