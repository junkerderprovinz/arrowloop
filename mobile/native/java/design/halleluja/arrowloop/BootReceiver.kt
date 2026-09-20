package design.halleluja.arrowloop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.File

/**
 * Re-arms the wake-ups after a reboot. The periodic job survives a reboot on
 * its own, but Android cannot persist the content trigger, so without this
 * the camera folder would stop being watched.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!hasWork(context)) {
            Log.i("ArrowLoop", "booted with no job configured, staying out of the way")
            Waker.disarm(context)
            return
        }
        Waker.arm(context)
    }

    /**
     * Reports whether the engine's configuration names a job. A text search
     * rather than a parse, since a broadcast receiver has only seconds to run.
     */
    private fun hasWork(context: Context): Boolean = try {
        val text = File(Engine.home(context), "arrowloop.json").readText()
        text.contains("\"name\"")
    } catch (_: Exception) {
        false
    }
}
