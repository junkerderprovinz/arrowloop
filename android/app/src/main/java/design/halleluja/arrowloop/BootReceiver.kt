package design.halleluja.arrowloop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import java.io.File

/**
 * Brings the engine back after a reboot up to Android 14, but only when a job
 * is configured, so an app nobody has set up holds no foreground service and
 * notification.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!hasWork(context)) {
            Log.i("ArrowLoop", "booted with no job configured, staying out of the way")
            return
        }
        // Android 15 refuses a dataSync service started from a boot receiver,
        // and the refusal crashes the app. MainActivity starts it instead.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            Log.i("ArrowLoop", "booted, leaving the engine until the app is opened")
            return
        }
        EngineService.start(context)
    }

    /**
     * Whether the engine's configuration names any job. A text check is enough
     * for a broadcast receiver with seconds to live.
     */
    private fun hasWork(context: Context): Boolean = try {
        val text = File(Engine.home(context), "arrowloop.json").readText()
        text.contains("\"name\"")
    } catch (_: Exception) {
        false
    }
}
