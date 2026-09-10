package design.halleluja.arrowloop

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * The only bridge between the screens and the engine PROCESS.
 *
 * Six methods, and the list is short on purpose: everything that can be asked
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
    ReactContextBaseJavaModule(context) {

    override fun getName() = "ArrowLoopEngine"

    /**
     * Start the service, which starts the engine.
     *
     * The SERVICE rather than the process directly, and that is not a detour:
     * a plain child process is killed when the app leaves the screen, and a
     * sync tool that only works while somebody is looking at it is a file
     * manager. EngineService is what makes the process survive a pocket.
     */
    @ReactMethod
    fun start(promise: Promise) {
        try {
            EngineService.start(context)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("start", e.message, e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
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

    @ReactMethod
    fun storageGranted(promise: Promise) = promise.resolve(Storage.granted(context))

    @ReactMethod
    fun storagePossible(promise: Promise) = promise.resolve(Storage.possible)

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
}
