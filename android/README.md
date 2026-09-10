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

The APK is **unsigned**. Signing needs a keystore, and a workflow that quietly
signs with a throwaway key produces an app that installs once and can never be
updated: every later build would be a different app as far as Android is
concerned.

## What it can reach

This is the open question, and it is worth reading before expecting the app to
sync a photo folder. See the note in `Engine.kt` and the project's own notes.
