package design.halleluja.arrowloop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.File

/**
 * Brings the engine back after a reboot, but only when a job is configured, so
 * an app nobody has set up holds no foreground service and notification.
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
