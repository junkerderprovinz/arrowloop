package design.halleluja.arrowloop

import android.app.Activity
import android.app.KeyguardManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File

/**
 * The native side of src/engine.ts: only what JavaScript cannot do, such as
 * running the engine binary and opening Android's settings pages. Anything
 * the engine can answer over HTTP goes through src/api.ts instead, so this
 * never becomes a second API.
 */
class EngineModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

    init {
        // confirmDeviceLock gets its answer through onActivityResult.
        context.addActivityEventListener(this)
    }

    override fun getName() = "ArrowLoopEngine"

    /**
     * Starts the engine for the screens as a plain child process, which a
     * visible app may run without a foreground service or its notification.
     * It dies with the app; scheduled runs go through Waker and EngineService.
     * The wake-ups are armed here, once the app has been opened.
     */
    @ReactMethod
    fun start(promise: Promise) {
        try {
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
        Thread { promise.resolve(Engine.answers()) }.start()
    }

    @ReactMethod
    fun storageGranted(promise: Promise) = promise.resolve(Storage.granted(context))

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
     * Asks for the exemption with Android's one-button prompt, falling back to
     * the optimisation list on builds that strip the prompt.
     */
    @ReactMethod
    @android.annotation.SuppressLint("BatteryLife")
    fun askBatteryExemption(promise: Promise) {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:${context.packageName}"))
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        for (intent in listOf(direct, list)) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                promise.resolve(null)
                return
            } catch (_: ActivityNotFoundException) {
                // Try the list before giving up.
            }
        }
        promise.reject("battery", "this phone has no page for that permission")
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
     * Opens the battery optimisation list, for phones whose OEM power manager
     * overrides the exemption prompt.
     */
    @ReactMethod
    fun openBatterySettings(promise: Promise) {
        val pages = listOf(
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
     * Writes a settings backup to the public Downloads folder under a fixed
     * name. The app's all-files access covers it, so no picker is needed.
     */
    @ReactMethod
    fun exportSettings(json: String, promise: Promise) {
        try {
            val folder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            folder.mkdirs()
            val file = File(folder, BACKUP_NAME)
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
            val file = if (path.isBlank()) {
                File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    BACKUP_NAME,
                )
            } else {
                File(path)
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
        val folder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        promise.resolve(File(folder, BACKUP_NAME).absolutePath)
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

    // Non-null parameters, as React Native's interface declares them; nullable
    // ones would override nothing.
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != UNLOCK_REQUEST) return
        val waiting = pending ?: return
        pending = null
        waiting.resolve(resultCode == Activity.RESULT_OK)
    }

    override fun onNewIntent(intent: Intent) {}

    companion object {
        const val BACKUP_NAME = "arrowloop-einstellungen.json"
        private const val UNLOCK_REQUEST = 8422
    }

    private var pending: Promise? = null
}
