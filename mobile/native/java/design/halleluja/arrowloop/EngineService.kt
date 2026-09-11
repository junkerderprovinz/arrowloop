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
import androidx.core.app.NotificationCompat
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * The engine, alive for exactly as long as a sync takes.
 *
 * It used to be alive permanently, and on Android that means a notification in
 * the shade permanently: a foreground service MUST show one, and there is no
 * flag that hides it. jdp: "die app soll keine dauerhafte benachrichtigung
 * haben." So the service is no longer something that RUNS; it is something that
 * HAPPENS, started by a wake-up from Android and stopping itself the moment the
 * run is over. The notification comes and goes with the copying, which is the
 * only time there is anything to tell anybody about.
 *
 * The app's own use of the engine does not come through here at all. While
 * somebody is looking at a screen, the process is simply a child of a visible
 * app, which Android lets live without a service and therefore without a
 * notification - see EngineModule.start.
 *
 * `dataSync` is the declared type, and it is the honest one: this moves files
 * between two places on somebody's behalf. It also carries the rules that come
 * with it - since Android 14 a dataSync service is capped at six hours in a day
 * - and those rules now cost nothing, because the service only exists while a
 * sync does.
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

        // The notification goes up BEFORE the work starts, and that ordering is
        // the whole contract: a foreground service that has not called
        // startForeground within a few seconds is killed with an exception
        // naming a timeout rather than the work.
        startForeground(
            NOTIFICATION_ID,
            notification(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            else 0,
        )

        // WHO started it decides who may stop it. With the app open the engine
        // is already running as the screens' own child process, and a wake-up
        // that stopped it on the way out would blank the app mid-tap - which it
        // did, with "the engine exited with code 143" in the log and nothing on
        // screen to explain it.
        ours = Engine.start(this)

        // Watching for the charger and the connection starts with the service
        // rather than with the screens, because the moment this matters is a
        // moment with no screen: it is what tells the engine whether this run
        // is allowed to go ahead at all.
        Device.watch(this)
        Thread { work() }.start()

        // START_NOT_STICKY, where this used to ask to be brought back. Coming
        // back is Android's business now, through the wake-ups in Waker, and a
        // service that restarted itself after being reclaimed would be a
        // notification reappearing for a run nobody asked for.
        return START_NOT_STICKY
    }

    /**
     * Ask the engine to catch up, then get out of the way.
     *
     * The engine decides WHAT is due, from the cron expressions in its own
     * configuration; this only says when. The call blocks for as long as the
     * copying takes, which is why it runs on its own thread and why the service
     * outlives the wake-up that started it.
     */
    private fun work() {
        try {
            waitForEngine()
            Log.i(TAG, "woke, ran ${runDueNow()} job(s)")
        } catch (e: Exception) {
            // Said out loud rather than swallowed. A wake-up that achieved
            // nothing and reported nothing is indistinguishable from one that
            // never happened, and "my schedule does not run" is the complaint
            // with the least evidence behind it of any in this program.
            Log.w(TAG, "woke and could not run: ${e.javaClass.simpleName} ${e.message}")
        } finally {
            finish()
        }
    }

    /** Up to thirty seconds for the engine to answer. It is a process start and
     *  a database open rather than a network call, so this is a wide margin. */
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
        throw IllegalStateException("the engine did not answer within thirty seconds")
    }

    private fun runDueNow(): Int {
        val call = URL("${Engine.ORIGIN}/api/run-due").openConnection() as HttpURLConnection
        call.requestMethod = "POST"
        call.doOutput = true
        call.connectTimeout = 5000
        // No read timeout at all. The answer arrives when the copying has
        // finished, and a cap here would be this program deciding how long
        // somebody's photos are allowed to take.
        call.readTimeout = 0
        OutputStreamWriter(call.outputStream).use { it.write("{}") }
        val body = call.inputStream.bufferedReader().readText()
        call.disconnect()
        return Regex("\"ran\":(\\d+)").find(body)?.groupValues?.get(1)?.toIntOrNull() ?: 0
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

    private fun channel() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        val channel = NotificationChannel(
            CHANNEL,
            getString(R.string.channel_engine),
            // LOW: it must be visible, because that is what a foreground
            // service is, and it must never make a sound. Nobody wants a chime
            // because a folder synced.
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.channel_engine_why)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
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
            // A way OUT of the notification, because a notification that can
            // only be swiped and comes straight back reads as an app that will
            // not let go. This one stops the run and means it.
            .addAction(0, getString(R.string.notify_stop), stop)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    companion object {
        const val TAG = "ArrowLoop"
        const val CHANNEL = "engine"
        const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "design.halleluja.arrowloop.STOP"

        /** Run whatever the clock should already have run. Started by a wake-up
         *  from Android and by nothing else: the app's own screens talk to a
         *  plain child process that needs no service at all. */
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
