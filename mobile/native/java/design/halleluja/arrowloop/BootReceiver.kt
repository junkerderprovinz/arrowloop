package design.halleluja.arrowloop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.File

/**
 * Put the alarm clock back after a reboot.
 *
 * It used to start the engine, which meant a notification from the first second
 * after every restart. Now it arms the wake-ups and nothing runs at all until
 * one of them fires - the periodic entry survives a reboot on its own, but the
 * content trigger cannot be persisted (Android refuses the combination), so
 * without this the camera would stop being watched at the first restart and
 * nothing would say so.
 *
 * The check for a configured job stays, and means more than it did. An app
 * nobody has set up has no schedule to keep, so arming a wake-up for it would
 * be spending somebody's battery on a question with no answer.
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
