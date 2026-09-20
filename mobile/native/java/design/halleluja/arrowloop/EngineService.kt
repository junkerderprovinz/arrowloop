package design.halleluja.arrowloop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import org.json.JSONObject
import androidx.core.app.NotificationCompat
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Runs the engine for one scheduled wake-up and stops when the run is over, so
 * its required foreground notification lasts only as long as the copying. The
 * screens do not use it: while the app is visible the engine runs as its plain
 * child process (see EngineModule.start). The service type is dataSync, which
 * Android 14 caps at six hours a day.
 */
class EngineService : Service() {

    /** Whether this service is the one that started the engine process. */
    private var ours = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        channel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            finish()
            return START_NOT_STICKY
        }

        // Before any work: a foreground service that does not call
        // startForeground within a few seconds is killed.
        startForeground(
            NOTIFICATION_ID,
            notification(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            else 0,
        )

        // Only the service that started the engine stops it; with the app open
        // the engine belongs to the screens, and stopping it would blank them.
        ours = Engine.start(this)

        // The run conditions matter most when no screen is open.
        Device.watch(this)
        Thread { work() }.start()

        // Waker brings the service back; restarting itself would only bring
        // back the notification.
        return START_NOT_STICKY
    }

    /**
     * Asks the engine to run whatever its cron expressions say is due. The call
     * blocks until the copying is done, hence the thread.
     */
    private fun work() {
        try {
            waitForEngine()
            val due = runDueNow()
            Log.i(TAG, "woke, ran ${due.ran} job(s), ${due.failed} failed")
            report(due)
        } catch (e: Exception) {
            Log.w(TAG, "woke and could not run: ${e.javaClass.simpleName} ${e.message}")
            // A reason this app authored is shown translated, anything else as
            // the raw message.
            val why = if (e is Silent) getString(e.said) else e.message ?: ""
            tell(CHANNEL_FAILED, FAILED_ID, getString(R.string.notify_failed), why)
        } finally {
            finish()
        }
    }

    /**
     * Posts the outcome on the matching channel. A run that changed nothing, or
     * a held job, posts nothing: the phone wakes every fifteen minutes.
     */
    private fun report(due: Due) {
        if (due.failed > 0) {
            tell(CHANNEL_FAILED, FAILED_ID, getString(R.string.notify_failed), due.reason)
            return
        }
        if (!due.changed()) return
        tell(
            CHANNEL_DONE,
            DONE_ID,
            getString(R.string.notify_done),
            getString(R.string.notify_done_what, due.copied, due.moved, due.trashed, due.conflicts),
        )
    }

    /** Posts a notification that replaces the previous one with the same id. */
    private fun tell(channel: String, id: Int, title: String, detail: String) {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val note = NotificationCompat.Builder(this, channel)
            .setContentTitle(title)
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            getSystemService(NotificationManager::class.java).notify(id, note)
        } catch (_: SecurityException) {
            // Notifications were refused; the app's history still has the run.
        }
    }

    /** Waits up to thirty seconds for the engine to answer. */
    private fun waitForEngine() {
        repeat(60) {
            try {
                val probe = URL("${Engine.ORIGIN}/api/capabilities").openConnection() as HttpURLConnection
                probe.connectTimeout = 1000
                probe.readTimeout = 1000
                val code = probe.responseCode
                probe.disconnect()
                if (code in 200..299) return
            } catch (_: Exception) {
                // Not up yet.
            }
            Thread.sleep(500)
        }
        throw Silent(R.string.notify_failed_no_engine)
    }

    /**
     * A failure this app authored, carrying a string resource so the
     * notification is in the phone's language. The English message is for the
     * log.
     */
    private class Silent(val said: Int) : IllegalStateException("the engine did not answer within thirty seconds")

    /** The summary of one wake-up, as the engine reports it. */
    private data class Due(
        val ran: Int = 0,
        val failed: Int = 0,
        val copied: Int = 0,
        val moved: Int = 0,
        val trashed: Int = 0,
        val conflicts: Int = 0,
        val reason: String = "",
    ) {
        fun changed() = copied + moved + trashed + conflicts > 0
    }

    private fun runDueNow(): Due {
        val call = URL("${Engine.ORIGIN}/api/run-due").openConnection() as HttpURLConnection
        call.requestMethod = "POST"
        call.doOutput = true
        call.connectTimeout = 5000
        // No read timeout: the answer arrives when the copying has finished.
        call.readTimeout = 0
        OutputStreamWriter(call.outputStream).use { it.write("{}") }
        val body = call.inputStream.bufferedReader().readText()
        call.disconnect()

        val json = JSONObject(body)
        return Due(
            ran = json.optInt("ran"),
            failed = json.optInt("failed"),
            copied = json.optInt("copied"),
            moved = json.optInt("moved"),
            trashed = json.optInt("trashed"),
            conflicts = json.optInt("conflicts"),
            reason = json.optString("reason"),
        )
    }

    private fun finish() {
        if (ours) {
            Device.forget(this)
            Engine.stop()
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (ours) {
            Device.forget(this)
            Engine.stop()
        }
        super.onDestroy()
    }

    /**
     * Creates one channel per thing the app can say: running, finished,
     * failed. Only failures make a sound. Android lets only the person change
     * a channel's importance once it exists, so these are starting points.
     */
    private fun channel() {
        val manager = getSystemService(NotificationManager::class.java)
        val wanted = listOf(
            Triple(CHANNEL, R.string.channel_engine, R.string.channel_engine_why)
                to NotificationManager.IMPORTANCE_LOW,
            Triple(CHANNEL_DONE, R.string.channel_done, R.string.channel_done_why)
                to NotificationManager.IMPORTANCE_LOW,
            Triple(CHANNEL_FAILED, R.string.channel_failed, R.string.channel_failed_why)
                to NotificationManager.IMPORTANCE_DEFAULT,
        )
        for ((names, importance) in wanted) {
            val (id, title, why) = names
            if (manager.getNotificationChannel(id) != null) continue
            manager.createNotificationChannel(
                NotificationChannel(id, getString(title), importance).apply {
                    description = getString(why)
                    setShowBadge(id == CHANNEL_FAILED)
                },
            )
        }
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, EngineService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.notify_running))
            .setContentText(getString(R.string.notify_running_why))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(open)
            .addAction(0, getString(R.string.notify_stop), stop)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    companion object {
        const val TAG = "ArrowLoop"
        const val CHANNEL = "engine"
        const val CHANNEL_DONE = "done"
        const val CHANNEL_FAILED = "failed"
        const val NOTIFICATION_ID = 1
        /** Fixed ids, so the latest run replaces the previous notification. */
        const val DONE_ID = 2
        const val FAILED_ID = 3
        const val ACTION_STOP = "design.halleluja.arrowloop.STOP"

        /** Starts the service to run whatever is due. Only a wake-up calls this. */
        fun runDue(context: Context) {
            val intent = Intent(context, EngineService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
