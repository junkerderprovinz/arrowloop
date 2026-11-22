package arrowloop.halleluja.design

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.File
import java.security.SecureRandom

/**
 * Starts what an automation app's ArrowLoop action asks for when the
 * automation fires. Any app on the phone can send this broadcast, so the
 * bundle is read by StartJob.read and nothing else in it is trusted.
 */
class StartJobReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != FIRE_SETTING) return
        val asked = try {
            val bundle = intent.getBundleExtra(EXTRA_BUNDLE)
            if (bundle == null) {
                StartJob.Asked.Refused("the broadcast carries no bundle")
            } else {
                StartJob.read(
                    bundle.getInt(StartJob.KEY_VERSION, -1),
                    bundle.getString(StartJob.KEY_JOB),
                    bundle.getString(StartJob.KEY_PROOF),
                    key(context, make = false),
                )
            }
        } catch (e: Exception) {
            // Unparcelling another app's bundle can throw, as on a class this
            // app does not have.
            StartJob.Asked.Refused("the bundle could not be read: ${e.javaClass.simpleName}")
        }
        when (asked) {
            is StartJob.Asked.Refused -> Log.w(TAG, "an automation app asked to start a job, refused: ${asked.why}")
            is StartJob.Asked.Start -> start(context, asked.job)
        }
    }

    private fun start(context: Context, job: String) {
        Log.i(TAG, "an automation app asked to start ${if (job == StartJob.ALL) "every job" else "job $job"}")
        try {
            EngineService.startJob(context, job)
        } catch (e: IllegalStateException) {
            Log.i(TAG, "starting inside a job, since Android refused the service: ${e.message}")
            Waker.startJob(context, job)
        }
    }

    companion object {
        private const val TAG = "ArrowLoop"

        const val FIRE_SETTING = "com.twofortyfouram.locale.intent.action.FIRE_SETTING"
        const val EXTRA_BUNDLE = "com.twofortyfouram.locale.intent.extra.BUNDLE"
        const val EXTRA_BLURB = "com.twofortyfouram.locale.intent.extra.BLURB"

        private fun keyFile(context: Context) = File(context.filesDir, "start-job.key")

        /**
         * The key the bundle's proof is drawn with, made on the first visit to
         * the picker. It stays in the app's private files, so clearing the
         * app's data makes every action set up before refuse to start.
         */
        @Synchronized
        fun key(context: Context, make: Boolean): String {
            val file = keyFile(context)
            val kept = try {
                file.readText().trim()
            } catch (_: Exception) {
                ""
            }
            if (kept.isNotEmpty() || !make) return kept
            val fresh = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
            file.writeText(fresh)
            return fresh
        }
    }
}
