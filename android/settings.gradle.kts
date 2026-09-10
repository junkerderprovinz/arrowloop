// The Android app is one module. There is no library split, and that is a
// decision rather than a stage nobody got round to: everything this app does is
// start the engine, put its interface on screen and hand it folders. Splitting
// three files across three modules buys a build graph and costs a reader.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ArrowLoop"
include(":app")
