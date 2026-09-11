package design.halleluja.arrowloop

import android.app.Activity
import android.app.KeyguardManager
import android.content.ActivityNotFoundException
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
import java.io.File

/**
 * The only bridge between the screens and the engine PROCESS.
 *
 * A short list on purpose: everything that can be asked
 * over HTTP is asked over HTTP, by `src/api.ts`, against the same API the web
 * interface uses. What crosses into Kotlin is only what has no expression in
 * JavaScript - executing a binary out of the native library directory, holding
 * a foreground service, and a permission Android grants on a settings page
 * rather than in a dialog.
 *
 * Keeping that line sharp is what stops this from becoming a second API. A
 * `listJobs` here would be a second way to ask the same question, and the two
 * would disagree the first time a field changed.
 */
class EngineModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

    init {
        // For `confirmDeviceLock`, which is the one thing here that asks
        // Android a question and waits for an answer.
        context.addActivityEventListener(this)
    }

    override fun getName() = "ArrowLoopEngine"

    /**
     * Start the engine for the screens, as a PLAIN CHILD PROCESS.
     *
     * Not through the foreground service, and that is the whole of why this app
     * no longer has a permanent notification: a service must show one, and
     * while somebody is looking at a screen there is nothing to tell them that
     * the screen does not already say. A child process of a visible app is
     * allowed to live, so this is all it takes.
     *
     * It dies with the app, which is correct: the background half is not this
     * process at all. Android wakes the app on its own schedule and the service
     * runs then, for as long as the copying takes - see Waker.
     *
     * The wake-ups are armed here too, because this is the moment there is
     * something to wake up FOR: the app has been opened, so a configuration
     * exists to read.
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

    /** Stop the engine, and any run the service happens to be holding. */
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

    /**
     * The engine's own log for this run.
     *
     * Handed over whole rather than tailed here. Which lines matter is a
     * question about what is on screen, and the screen is in JavaScript - the
     * WebView shell got this backwards and showed the LAST twenty lines of a
     * Go crash, which is a register dump, while the one sentence explaining it
     * scrolled off the top.
     */
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

    /** Whether the process we started is still running - which an empty log
     *  cannot say, because "died before writing" and "running and quiet" look
     *  identical from outside. */
    @ReactMethod
    fun alive(promise: Promise) = promise.resolve(Engine.alive())

    /**
     * Whether the engine is UP, as opposed to whether this object started it.
     *
     * `alive` asks about the process handle, and that is the right question for
     * telling "died before it could write" from "running and quiet". It is the
     * wrong question for a card that says whether the engine is running:
     * `Engine.start` deliberately returns early when the engine already
     * ANSWERS, so the handle stays null, and the settings card then reported
     * "the engine is stopped" next to an app that was talking to it. Seen on
     * the device: the card said stopped while the export it sits above had just
     * read the configuration over HTTP.
     *
     * Off the main thread, because it is a socket: a probe on the UI thread is
     * a frame dropped every time the card refreshes.
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
     * The two schedule conditions, and the facts behind them.
     *
     * Both halves in one answer on purpose. A switch that says "only while
     * charging" while the phone is on battery is a switch whose consequence is
     * invisible, and somebody then waits all evening for a run that was never
     * going to start. The screen says which of them is holding things up
     * because this hands it the live state alongside the preference.
     */
    @ReactMethod
    fun devicePolicy(promise: Promise) {
        val map = Arguments.createMap()
        map.putBoolean("onlyCharging", Device.onlyCharging(context))
        map.putBoolean("onlyWifi", Device.onlyWifi(context))
        map.putBoolean("charging", Device.charging(context))
        map.putBoolean("onWifi", Device.onWifi(context))
        map.putString("holding", Device.reason(context))
        promise.resolve(map)
    }

    @ReactMethod
    fun setDevicePolicy(onlyCharging: Boolean, onlyWifi: Boolean, promise: Promise) {
        Device.setPolicy(context, onlyCharging, onlyWifi)
        promise.resolve(null)
    }

    /**
     * Whether Android has agreed to leave this app alone in the background.
     *
     * The permission behind every complaint a sync tool on Android ever gets.
     * Doze puts an app it considers idle to sleep, and a job set for three in
     * the morning then runs whenever the phone next wakes up, which is when
     * somebody picks it up at breakfast. The exemption is the difference
     * between a schedule and a suggestion.
     */
    @ReactMethod
    fun batteryExempt(promise: Promise) {
        val manager = context.getSystemService(PowerManager::class.java)
        promise.resolve(manager?.isIgnoringBatteryOptimizations(context.packageName) ?: true)
    }

    /**
     * Ask for that exemption, which really is one dialog with one button.
     *
     * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is the rare Android
     * permission that still shows a prompt rather than a settings page. Where a
     * build refuses it - some manufacturers strip it - the fallback lands on
     * the list, which is a page rather than a prompt but is at least the right
     * page.
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
                // Try the page before giving up.
            }
        }
        promise.reject("battery", "this phone has no page for that permission")
    }

    /**
     * Open the page that grants file access.
     *
     * There is no dialog for this one. Google routed the broadest file
     * permission there is through a full settings page rather than a
     * two-button prompt, so "ask for it like the notification permission" is
     * not available - the closest thing is landing somebody on a page with a
     * single switch, which is what the targeted intent does.
     *
     * FLAG_ACTIVITY_NEW_TASK because this is started from a module rather than
     * from an Activity, and without it Android refuses the intent outright.
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
                // The targeted per-package page first, the list of every app as
                // a fallback: some builds refuse the first form, and an
                // unhandled intent would crash the app on the one control that
                // is supposed to fix things.
            }
        }
        promise.reject("storage", "this phone has no page for that permission")
    }

    /**
     * Open this app's own settings page.
     *
     * Where the notification permission ends up once it has been refused. The
     * request dialog is a one-shot: after a no, `requestPermissions` returns
     * immediately with the same no and shows nothing, and a switch that does
     * nothing twice reads as a broken switch rather than as a decision already
     * made. This is the page where that decision can be changed.
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
     * Android's OWN notification settings for this app.
     *
     * jdp: "die einstellungen für die benachrichtigungen sollen wir in die
     * nativen Android Benachrichtigungseinstellungen der app verlinken wie in
     * Autosync." Which is the right answer rather than a shortcut: sound,
     * vibration, banners, Do Not Disturb and the per-channel switches are all
     * Android's to own, and an app that rebuilt them would be offering a second
     * set of switches over the same state - two answers to one question, and
     * the phone's own is the one that actually applies.
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
     * The battery-optimisation list, where this app can be excluded.
     *
     * Different from `askBatteryExemption` on purpose, and both are needed. The
     * ASK is one dialog with one button and it is what most people should use;
     * this is the LIST, which is where an OEM's own power manager puts the
     * setting that actually decides whether a background job ever runs. On the
     * phones where the dialog is not enough, this is the page to be on.
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
     * Write a settings backup where somebody can actually find it.
     *
     * The public Downloads folder, by a fixed name, because a backup nobody can
     * locate is not a backup. The app already holds all-files access for the
     * folders it syncs, so this needs no picker and no second permission - and
     * a picker would put the file somewhere different every time, which is the
     * opposite of what "where did I put it" wants.
     */
    @ReactMethod
    fun exportSettings(json: String, promise: Promise) {
        try {
            val folder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            folder.mkdirs()
            val file = File(folder, BACKUP_NAME)
            // Built fully before the file is opened. `File.writeText` truncates
            // on open, so a failure while producing the bytes would leave an
            // empty backup where a good one used to be.
            val bytes = json.toByteArray(Charsets.UTF_8)
            file.writeBytes(bytes)
            promise.resolve(file.absolutePath)
        } catch (e: Exception) {
            promise.reject("export", e.message ?: "could not write the backup")
        }
    }

    /** Read a backup back. The path is handed in, so a file moved somewhere
     *  else is still reachable by typing where it went. */
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

    /** The default place a backup goes, so the screen can show it before one
     *  has ever been written. */
    @ReactMethod
    fun backupPath(promise: Promise) {
        val folder = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        promise.resolve(File(folder, BACKUP_NAME).absolutePath)
    }

    /**
     * Whether this phone HAS a lock to ask for.
     *
     * `isDeviceSecure` rather than `isKeyguardSecure`: the second is true for a
     * swipe-to-unlock screen, which protects nothing. A lock offered on a phone
     * with no PIN would be a switch that turns on and then lets everybody in.
     */
    @ReactMethod
    fun hasDeviceLock(promise: Promise) {
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        promise.resolve(keyguard?.isDeviceSecure ?: false)
    }

    /**
     * Ask for the phone's own lock, and say whether it was given.
     *
     * The DEVICE's lock rather than an app PIN, which is what jdp asked for
     * ("die möglichkeit die app zu sperren (gerätesperre)") and is the better
     * of the two anyway: a second secret is a second thing to forget, and the
     * app that offers one has to answer "what if I forget it" with "wipe the
     * app data". The system dialog already offers a fingerprint where one is
     * enrolled, so this is not a choice between the lock and biometrics.
     *
     * `createConfirmDeviceCredentialIntent` rather than BiometricPrompt because
     * it needs no new dependency and asks exactly this question. It returns
     * through onActivityResult, which is why the module is an
     * ActivityEventListener.
     */
    @ReactMethod
    fun confirmDeviceLock(title: String, detail: String, promise: Promise) {
        // `context.currentActivity`, not the module's own `currentActivity`:
        // the inherited one is deprecated as of React Native 0.80 and is not on
        // the class at all here. The local build compiled a STALE copy of this
        // file and said nothing, so CI is what found it.
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
        // One at a time. A second ask while the first is on screen would leave
        // the first promise unresolved for ever, which in the app is a lock
        // screen that never goes away.
        pending?.reject("lock", "another unlock was already being asked for")
        pending = promise
        try {
            activity.startActivityForResult(intent, UNLOCK_REQUEST)
        } catch (e: Exception) {
            pending = null
            promise.reject("lock", e.message ?: "could not ask for the lock")
        }
    }

    // Both parameters are NON-NULL in this React Native's own interface, and
    // writing them nullable makes the override match nothing at all.
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != UNLOCK_REQUEST) return
        val waiting = pending ?: return
        pending = null
        waiting.resolve(resultCode == Activity.RESULT_OK)
    }

    override fun onNewIntent(intent: Intent) {
        // Nothing here. The interface wants both halves; only the result is
        // this module's business.
    }

    companion object {
        /** One name, so "where did I put it" has an answer. */
        const val BACKUP_NAME = "arrowloop-einstellungen.json"
        private const val UNLOCK_REQUEST = 8422
    }

    private var pending: Promise? = null
}
