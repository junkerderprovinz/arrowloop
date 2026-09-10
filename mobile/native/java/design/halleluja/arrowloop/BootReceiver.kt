package design.halleluja.arrowloop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.File

/**
 * Bring the engine back after a reboot, but only if it has something to do.
 *
 * A scheduled sync that stops existing when the phone restarts is a scheduled
 * sync nobody can rely on, and a phone restarts more often than anybody thinks:
 * an update, a flat battery, a crash.
 *
 * The check for a configured job is what keeps this from being rude. A freshly
 * installed app that nobody has set up yet has no reason to hold a foreground
 * service and a notification through every boot, and starting one anyway is the
 * behaviour that gets an app uninstalled.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!hasWork(context)) {
            Log.i("ArrowLoop", "booted with no job configured, staying out of the way")
            return
        }
        EngineService.start(context)
    }

    /**
     * Whether anything is set up, read from the engine's own configuration.
     *
     * Deliberately a crude check on the file rather than a parse: this runs in
     * a broadcast receiver with seconds to live, and the question is only "has
     * somebody set this up", which an empty job list answers as plainly as a
     * full parse would.
     */
    private fun hasWork(context: Context): Boolean = try {
        val text = File(Engine.home(context), "arrowloop.json").readText()
        text.contains("\"name\"")
    } catch (_: Exception) {
        false
    }
}
