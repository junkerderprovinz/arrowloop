plugins {
    id("com.android.application") version "8.7.3"
    id("org.jetbrains.kotlin.android") version "2.4.20"
}

android {
    namespace = "design.halleluja.arrowloop"
    compileSdk = 36

    defaultConfig {
        applicationId = "design.halleluja.arrowloop"

        // From 26 a foreground service is the way to keep working while the
        // screen is off.
        minSdk = 26

        // Android 14 capped a dataSync foreground service at six hours a day and
        // 15 added a timeout, so the newest level is the strictest, and an older
        // target would test against rules more lenient than users have.
        targetSdk = 36

        versionCode = 1
        versionName = "0.1.0"

    }

    // A committed debug key keeps the app updatable. Otherwise Gradle creates a
    // fresh debug keystore on every CI runner, and Android refuses each update
    // with INSTALL_FAILED_UPDATE_INCOMPATIBLE because the signatures differ.
    // The keystore holds Android's published debug credentials, so it grants
    // nothing the SDK's default key does not; a release key never lives here.
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
            // Nothing to shrink: the bulk of the APK is a native binary R8 never
            // touches.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    // One APK per architecture, since the engine is 75 MB each. This is the one
    // place the architectures may be named: `ndk.abiFilters` as well stops the
    // build with "abiFilters cannot be present when splits abi filters are set".
    // x86_64 is for the emulator; armeabi-v7a is left out because 32-bit phones
    // are too old to sync a photo library usefully.
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
            // The engine is executed rather than loaded, so it has to be
            // extracted as a real file. Since Android 10 the native library
            // directory is the only place an app may exec from, hence the name
            // libarrowloop.so for a program.
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
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.documentfile:documentfile:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    // Waiting for the engine to open its port without blocking the screen.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
