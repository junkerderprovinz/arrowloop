plugins {
    id("com.android.application") version "8.7.3"
    id("org.jetbrains.kotlin.android") version "2.0.21"
}

android {
    namespace = "design.halleluja.arrowloop"
    compileSdk = 36

    defaultConfig {
        applicationId = "design.halleluja.arrowloop"

        // 26 is where a foreground service became the only honest way to keep
        // working while the screen is off, which is the entire point of this
        // app. Below it there is nothing to build on.
        minSdk = 26

        // 36 is Android 16, and the same reasoning as the emulator's: 14 added
        // the six-hour daily cap on a dataSync foreground service, 15 added a
        // timeout on top and 16 keeps both, so the newest level is the
        // STRICTEST rather than a different one. Targeting anything older would
        // be asking the system for rules more lenient than the ones the people
        // running it actually have - and the Play Store requires a recent
        // target for a new listing anyway.
        targetSdk = 36

        versionCode = 1
        versionName = "0.1.0"

    }

    // ONE debug key, kept in the repo, and that is what makes the app
    // updatable at all.
    //
    // Without this, Gradle signs a debug build with whatever debug keystore it
    // finds in the builder's home directory - and creates one if there is
    // none. A CI runner is thrown away after every job, so every build carried
    // a DIFFERENT key, and to Android a different signing key is a different
    // app. jdp hit it head on: "ich kann die app nicht updaten weil sie mit
    // einem bestehenden paket in konflikt ist". Reproduced on the rig, install
    // the previous build then the current one over it:
    //
    //   INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package
    //   design.halleluja.arrowloop signatures do not match newer version
    //
    // So every update meant uninstalling first, which throws away the app's
    // settings and every job in it - and the failure says "conflicts with an
    // existing package", which sounds like something else entirely.
    //
    // Committing a keystore is safe HERE and would not be everywhere. This one
    // holds Android's own published debug credentials: alias androiddebugkey,
    // password "android", the same pair every Android SDK on earth ships with.
    // It grants nothing that the SDK's default key does not already grant to
    // anybody. The RELEASE build is untouched and stays unsigned until there
    // is a real keystore to sign it with - that key must never live here.
    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            // No shrinking. There is nothing to shrink: the app is three Kotlin
            // files, and the 75 MB that matters is a native binary R8 never
            // touches. Turning it on would only buy a mapping file to lose.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    // One APK per architecture rather than one carrying both, and the ONLY
    // place the architectures are named. Saying it here and again in
    // `ndk.abiFilters` is not a second filter, it is a conflict: the build
    // stops with "abiFilters cannot be present when splits abi filters are
    // set", which reads like a rule about one of them and is a rule about
    // having both.
    //
    // arm64 is every phone sold in the last decade; x86_64 is what the emulator
    // is, so the rig this was developed against installs the same build.
    // armeabi-v7a is left out deliberately: the engine is 75 MB per
    // architecture, and a 32-bit phone that can usefully sync a photo library
    // is not a real device any more. A universal APK would be 150 MB of which
    // every phone uses half.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = false
        }
    }

    packaging {
        jniLibs {
            // The engine has to arrive UNCOMPRESSED and stay a real file on
            // disk, because it is executed rather than loaded. Since Android 10
            // an app may not exec anything out of its own data directory: the
            // one place left is the native library directory, which is why the
            // binary is shipped as `libarrowloop.so` even though it is a
            // program and not a library.
            useLegacyPackaging = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    // Waiting for the engine to open its port without blocking the screen.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
