package arrowloop.halleluja.design

import android.app.Activity
import android.app.KeyguardManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentCallbacks
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.OpenableColumns
import android.provider.Settings
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.IOException

/**
 * The native side of src/engine.ts: only what JavaScript cannot do, such as
 * running the engine binary and opening Android's settings pages. Anything
 * the engine can answer over HTTP goes through src/api.ts instead, so this
 * never becomes a second API.
 */
class EngineModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener, LifecycleEventListener {

    // A new wallpaper brings a new palette as a configuration change, which can
    // arrive while the app is in front.
    private val paletteWatch = object : ComponentCallbacks {
        override fun onConfigurationChanged(newConfig: Configuration) {
            if (context.hasActiveReactInstance()) context.emitDeviceEvent(ACCENT_EVENT, accentTones())
        }

        override fun onLowMemory() {}
    }

    init {
        // confirmDeviceLock gets its answer through onActivityResult.
        context.addActivityEventListener(this)
        context.addLifecycleEventListener(this)
        context.registerComponentCallbacks(paletteWatch)
    }

    override fun getName() = "ArrowLoopEngine"

    /**
     * A run started from the screens has to outlive them, and Android lets
     * the service take it over only while the app is still in front.
     */
    override fun onHostPause() {
        Thread { EngineService.leave(context) }.start()
    }

    override fun onHostResume() {
        EngineService.back(context)
        // A certificate authority is installed in Android's settings, so coming
        // back from there is when the engine has to learn about it.
        Thread { if (Authorities.changed(context)) Engine.restart(context) }.start()
    }

    override fun onHostDestroy() {}

    /**
     * Starts the engine for the screens as a plain child process, which a
     * visible app may run without a foreground service or its notification.
     * It dies with the app; scheduled runs go through Waker and EngineService.
     * The wake-ups are armed here, once the app has been opened.
     */
    @ReactMethod
    fun start(promise: Promise) {
        try {
            // Set first, or a wake-up finishing in the meantime could stop the
            // engine this start has just found running.
            Engine.screens = true
            Engine.start(context)
            Device.watch(context)
            Waker.arm(context)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("start", e.message, e)
        }
    }

    /** Stops the engine and any run the service is holding. */
    @ReactMethod
    fun stop(promise: Promise) {
        try {
            Engine.screens = false
            Device.forget(context)
            Engine.stop()
            context.startService(
                Intent(context, EngineService::class.java).setAction(EngineService.ACTION_STOP),
            )
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("stop", e.message, e)
        }
    }

    /** Returns the whole engine log; the screen decides which lines to show. */
    @ReactMethod
    fun log(promise: Promise) {
        promise.resolve(
            try {
                File(Engine.home(context), "engine.log").takeIf { it.exists() }?.readText() ?: ""
            } catch (e: Exception) {
                "the log could not be read: ${e.javaClass.simpleName} ${e.message}"
            },
        )
    }

    /** Reports whether the process this app started is still running. */
    @ReactMethod
    fun alive(promise: Promise) = promise.resolve(Engine.alive())

    /**
     * Reports whether the engine answers over HTTP. Unlike `alive` this is
     * true for an engine another caller started. The probe opens a socket, so
     * it runs off the main thread.
     */
    @ReactMethod
    fun answering(promise: Promise) {
        Thread { promise.resolve(Engine.answers(context)) }.start()
    }

    /** The token every request to the engine carries; see Engine.token. */
    @ReactMethod
    fun token(promise: Promise) {
        Thread { promise.resolve(Engine.token(context)) }.start()
    }

    /**
     * Reports how Android/data stands, under the names src/engine.ts uses,
     * and starts its server first if it is switched on and not up yet.
     */
    @ReactMethod
    fun appData(promise: Promise) = slowly(promise) { AppData.settle(context) }

    @ReactMethod
    fun setAppData(on: Boolean, promise: Promise) = slowly(promise) { AppData.setEnabled(context, on) }

    @ReactMethod
    fun setAppDataWay(way: String, promise: Promise) =
        slowly(promise) { AppData.setWay(context, AppData.Way.values().first { it.js == way }) }

    @ReactMethod
    fun setAppDataSu(su: String, promise: Promise) = slowly(promise) { AppData.setSu(context, su) }

    /** Resolves once the root manager has had its answer, or after its prompt timed out. */
    @ReactMethod
    fun requestRoot(promise: Promise) = slowly(promise) { AppData.requestRoot(context) }

    /** Resolves once the person has answered Shizuku's dialog. */
    @ReactMethod
    fun askShizuku(promise: Promise) = AppData.askShizuku(context) { promise.resolve(toJs(it)) }

    /** Runs work on a thread of its own, since su and Shizuku can take seconds. */
    private fun slowly(promise: Promise, work: () -> AppData.Report) {
        Thread {
            try {
                promise.resolve(toJs(work()))
            } catch (e: Exception) {
                promise.reject("appData", e.message, e)
            }
        }.start()
    }

    private fun toJs(report: AppData.Report) = Arguments.createMap().apply {
        putString("state", report.state.js)
        putString("way", report.way.js)
        putBoolean("root", report.root)
        putBoolean("shizuku", report.shizuku)
        putString("su", report.su)
    }

    /** The folders other apps share with ArrowLoop, as src/engine.ts reads them. */
    @ReactMethod
    fun sharedFolders(promise: Promise) {
        Thread { promise.resolve(foldersToJs()) }.start()
    }

    /**
     * Opens Android's folder picker and resolves with the folders once one
     * was picked and the engine started over, or at once on Back.
     */
    @ReactMethod
    fun addSharedFolder(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) {
            promise.reject("folder", "there is no screen to ask in front of")
            return
        }
        picking?.reject("folder", "another folder was already being picked")
        picking = promise
        val started = Docs.pickIntents().any { intent ->
            try {
                activity.startActivityForResult(intent, PICK_REQUEST)
                true
            } catch (e: ActivityNotFoundException) {
                false
            }
        }
        if (!started) {
            picking = null
            promise.reject("folder", "this phone has no folder picker")
        }
    }

    @ReactMethod
    fun removeSharedFolder(uri: String, promise: Promise) {
        Thread {
            Docs.remove(context, Uri.parse(uri))
            promise.resolve(foldersToJs())
        }.start()
    }

    private fun foldersToJs() = Arguments.createArray().apply {
        for (folder in Docs.folders(context)) {
            pushMap(
                Arguments.createMap().apply {
                    putString("name", folder.name)
                    putString("uri", folder.uri.toString())
                    putString("app", folder.app)
                },
            )
        }
    }

    @ReactMethod
    fun storageGranted(promise: Promise) = promise.resolve(Storage.check(context))

    @ReactMethod
    fun storagePossible(promise: Promise) = promise.resolve(Storage.possible)

    /**
     * Returns the run conditions together with the live readings, so a screen
     * can say which condition is holding runs.
     */
    @ReactMethod
    fun devicePolicy(promise: Promise) {
        val map = Arguments.createMap()
        map.putBoolean("onlyCharging", Device.onlyCharging(context))
        map.putBoolean("onlyWifi", Device.onlyWifi(context))
        map.putInt("minBattery", Device.minBattery(context))
        map.putBoolean("notRoaming", Device.notRoaming(context))
        map.putBoolean("notMetered", Device.notMetered(context))
        map.putBoolean("charging", Device.charging(context))
        map.putBoolean("onWifi", Device.onWifi(context))
        map.putInt("battery", Device.batteryLevel(context))
        map.putBoolean("roaming", Device.roaming(context))
        map.putBoolean("metered", Device.metered(context))
        map.putString("holding", Device.reason(context))
        promise.resolve(map)
    }

    /**
     * Takes a map rather than positional booleans, so swapped arguments cannot
     * compile. Keys the map leaves out keep their stored value.
     */
    @ReactMethod
    fun setDevicePolicy(policy: ReadableMap, promise: Promise) {
        Device.setPolicy(context, policy.toHashMap())
        promise.resolve(null)
    }

    /**
     * Reports whether the app is exempt from battery optimisation. Without it
     * Doze delays a night-time job until the phone next wakes.
     */
    @ReactMethod
    fun batteryExempt(promise: Promise) {
        val manager = context.getSystemService(PowerManager::class.java)
        promise.resolve(manager?.isIgnoringBatteryOptimizations(context.packageName) ?: true)
    }

    /**
     * Opens the settings page that grants file access; there is no dialog for
     * it. FLAG_ACTIVITY_NEW_TASK is required when starting from a module.
     */
    @ReactMethod
    fun openStorageSettings(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            promise.reject("storage", "this Android version has no such page")
            return
        }
        for (intent in listOf(Storage.manageIntent(context), Storage.manageIntentFallback())) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                promise.resolve(null)
                return
            } catch (_: ActivityNotFoundException) {
                // Some builds refuse the per-package page; try the app list.
            }
        }
        promise.reject("storage", "this phone has no page for that permission")
    }

    /**
     * Opens the app's settings page, where a refused permission can be granted
     * after the one-shot request dialog stops showing.
     */
    @ReactMethod
    fun openAppSettings(promise: Promise) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            promise.resolve(null)
        } catch (_: ActivityNotFoundException) {
            promise.reject("settings", "this phone has no app settings page")
        }
    }

    /**
     * Opens Android's notification settings for the app, which own sound,
     * vibration and the per-channel switches.
     */
    @ReactMethod
    fun openNotificationSettings(promise: Promise) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            promise.resolve(null)
            return
        } catch (_: ActivityNotFoundException) {
            // Some OEM builds route this through the app details page instead.
        }
        openAppSettings(promise)
    }

    /**
     * Asks for the battery exemption in Android's own one-tap prompt, or opens
     * the optimisation list once the app is exempt, where it can be taken back.
     * Some manufacturers add a background switch of their own that does not
     * grant the exemption; the prompt cannot be mistaken for it.
     */
    @ReactMethod
    fun openBatterySettings(promise: Promise) {
        val manager = context.getSystemService(PowerManager::class.java)
        val exempt = manager?.isIgnoringBatteryOptimizations(context.packageName) ?: true
        val prompt = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.fromParts("package", context.packageName, null))
        val pages = listOfNotNull(
            prompt.takeUnless { exempt },
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", context.packageName, null)),
        )
        for (page in pages) {
            try {
                context.startActivity(page.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                promise.resolve(null)
                return
            } catch (_: ActivityNotFoundException) {
                // Try the next one.
            }
        }
        promise.reject("battery", "this phone has no battery settings page")
    }

    /**
     * Writes a settings backup to the given file, or to the public Downloads
     * folder under a fixed name when the path is blank. A folder gets the
     * fixed name inside it. The app's all-files access covers both.
     */
    @ReactMethod
    fun exportSettings(json: String, path: String, promise: Promise) {
        try {
            val given = if (path.isBlank()) File(downloads(), BACKUP_NAME) else File(path)
            val file = if (given.isDirectory) File(given, BACKUP_NAME) else given
            file.parentFile?.mkdirs()
            // Encoded before the file is opened, since opening truncates it.
            val bytes = json.toByteArray(Charsets.UTF_8)
            file.writeBytes(bytes)
            promise.resolve(file.absolutePath)
        } catch (e: Exception) {
            promise.reject("export", e.message ?: "could not write the backup")
        }
    }

    /** Reads a backup from the given path, or from the default place when it is blank. */
    @ReactMethod
    fun importSettings(path: String, promise: Promise) {
        try {
            val file = when {
                path.isBlank() ->
                    File(downloads(), BACKUP_NAME).takeIf { it.exists() } ?: File(downloads(), OLD_BACKUP_NAME)
                File(path).isDirectory -> File(path, BACKUP_NAME)
                else -> File(path)
            }
            if (!file.exists()) {
                promise.reject("import", "there is no file at ${file.absolutePath}")
                return
            }
            promise.resolve(file.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            promise.reject("import", e.message ?: "could not read the backup")
        }
    }

    /** The default backup path, shown before a backup has been written. */
    @ReactMethod
    fun backupPath(promise: Promise) {
        promise.resolve(File(downloads(), BACKUP_NAME).absolutePath)
    }

    private fun downloads(): File = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)

    /**
     * Opens Android's file picker and resolves with the chosen file's name and
     * text, or with null on Back. The file is read through the picker's grant,
     * so it can come from anywhere the picker reaches, a cloud app's included.
     */
    @ReactMethod
    fun pickBackup(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) {
            promise.reject("backup", "there is no screen to ask in front of")
            return
        }
        choosing?.reject("backup", "another file was already being picked")
        choosing = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            // A FolderSync export or a luckyBackup profile is no JSON file.
            .setType("*/*")
        try {
            activity.startActivityForResult(intent, FILE_REQUEST)
        } catch (e: ActivityNotFoundException) {
            choosing = null
            promise.reject("backup", "this phone has no file picker")
        }
    }

    private fun readPicked(uri: Uri): WritableMap {
        val resolver = context.contentResolver
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }
        val text = resolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: throw IOException("could not open ${name ?: uri}")
        return Arguments.createMap().apply {
            putString("name", name ?: uri.lastPathSegment ?: uri.toString())
            putString("text", text)
        }
    }

    /**
     * Reports whether the phone has a real lock. `isKeyguardSecure` would also
     * accept swipe to unlock, which protects nothing.
     */
    @ReactMethod
    fun hasDeviceLock(promise: Promise) {
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        promise.resolve(keyguard?.isDeviceSecure ?: false)
    }

    /**
     * Asks for the phone's own lock, fingerprint included where enrolled, and
     * resolves whether it was given. It uses the device credential intent
     * rather than BiometricPrompt to avoid a dependency; the answer arrives in
     * onActivityResult.
     */
    @ReactMethod
    fun confirmDeviceLock(title: String, detail: String, promise: Promise) {
        // The module's inherited currentActivity is gone as of React Native 0.80.
        val activity = context.currentActivity
        if (activity == null) {
            promise.reject("lock", "there is no screen to ask in front of")
            return
        }
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        if (keyguard == null || !keyguard.isDeviceSecure) {
            promise.reject("lock", "this phone has no screen lock set up")
            return
        }
        @Suppress("DEPRECATION")
        val intent = keyguard.createConfirmDeviceCredentialIntent(title, detail)
        if (intent == null) {
            promise.reject("lock", "this phone will not ask for its own lock")
            return
        }
        // A second ask settles the first, which would otherwise never resolve.
        pending?.reject("lock", "another unlock was already being asked for")
        pending = promise
        try {
            activity.startActivityForResult(intent, UNLOCK_REQUEST)
        } catch (e: Exception) {
            pending = null
            promise.reject("lock", e.message ?: "could not ask for the lock")
        }
    }

    /**
     * Copies a string to the clipboard, since React Native's own Clipboard is
     * deprecated. The label, shown in the clipboard history, is the app's name.
     */
    @ReactMethod
    fun copy(value: String, promise: Promise) {
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        if (clipboard == null) {
            promise.reject("clipboard", "this phone has no clipboard service")
            return
        }
        try {
            clipboard.setPrimaryClip(ClipData.newPlainText("ArrowLoop", value))
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("clipboard", e.message ?: "could not copy")
        }
    }

    /**
     * Material You's primary as Material 3 takes it for the light look and for
     * the dark one, as ARGB ints, or null below Android 12, which has no
     * palette to read.
     */
    private fun accentTones(): WritableMap? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        return Arguments.createMap().apply {
            putInt("light", context.getColor(android.R.color.system_accent1_600))
            putInt("dark", context.getColor(android.R.color.system_accent1_200))
        }
    }

    @ReactMethod
    fun systemAccent(promise: Promise) = promise.resolve(accentTones())

    // Non-null parameters, as React Native's interface declares them; nullable
    // ones would override nothing.
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_REQUEST) {
            val waiting = choosing ?: return
            choosing = null
            val uri = data?.data
            if (resultCode != Activity.RESULT_OK || uri == null) {
                waiting.resolve(null)
                return
            }
            // A file from a cloud app can take a while to arrive.
            Thread {
                try {
                    waiting.resolve(readPicked(uri))
                } catch (e: Exception) {
                    waiting.reject("backup", e.message ?: "could not read the file")
                }
            }.start()
            return
        }
        if (requestCode == PICK_REQUEST) {
            val waiting = picking ?: return
            picking = null
            // Starting the engine over waits for it, which the main thread must not.
            Thread {
                try {
                    if (resultCode == Activity.RESULT_OK && data != null) Docs.add(context, data)
                    waiting.resolve(foldersToJs())
                } catch (e: Exception) {
                    waiting.reject("folder", e.message ?: "could not keep the folder")
                }
            }.start()
            return
        }
        if (requestCode != UNLOCK_REQUEST) return
        val waiting = pending ?: return
        pending = null
        waiting.resolve(resultCode == Activity.RESULT_OK)
    }

    override fun onNewIntent(intent: Intent) {}

    companion object {
        // Downloads is shared, so a test build next to the released app keeps
        // its own backup rather than overwriting the real one.
        val BACKUP_NAME = if (BuildConfig.SIDE_BY_SIDE) "arrowloop-test-settings.json" else "arrowloop-settings.json"

        // Older backups carry the German name and still restore.
        val OLD_BACKUP_NAME = if (BuildConfig.SIDE_BY_SIDE) "arrowloop-test-einstellungen.json" else "arrowloop-einstellungen.json"
        /** The event src/systemAccent.ts listens to for a new palette. */
        const val ACCENT_EVENT = "systemAccentChanged"
        private const val UNLOCK_REQUEST = 8422
        private const val PICK_REQUEST = 8425
        private const val FILE_REQUEST = 8426
    }

    private var pending: Promise? = null

    private var picking: Promise? = null

    private var choosing: Promise? = null
}
