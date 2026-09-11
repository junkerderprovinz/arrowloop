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
            val due = runDueNow()
            Log.i(TAG, "woke, ran ${due.ran} job(s), ${due.failed} failed")
            report(due)
        } catch (e: Exception) {
            // Said out loud rather than swallowed. A wake-up that achieved
            // nothing and reported nothing is indistinguishable from one that
            // never happened, and "my schedule does not run" is the complaint
            // with the least evidence behind it of any in this program.
            Log.w(TAG, "woke and could not run: ${e.javaClass.simpleName} ${e.message}")
            // The phone's language where this app knows the reason, and the raw
            // message only where it does not. An empty detail rather than an
            // English one would be worse: a notification saying a sync failed
            // and refusing to say why is the complaint with the least evidence
            // behind it of any in this program.
            val why = if (e is Silent) getString(e.said) else e.message ?: ""
            tell(CHANNEL_FAILED, FAILED_ID, getString(R.string.notify_failed), why)
        } finally {
            finish()
        }
    }

    /**
     * What the run did, on the channel that matches the outcome.
     *
     * SILENT when nothing changed, and that is the rule worth stating: a phone
     * that syncs every fifteen minutes would otherwise post ninety-six "nothing
     * to do" notifications a day, and the one that mattered would be the
     * ninety-seventh nobody read. A quiet night is the normal case and normal
     * cases do not interrupt.
     *
     * A HELD job is not a failure either - a drive in somebody's bag has not
     * gone wrong - so it says nothing at all. The log line already carries it
     * for anybody looking.
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

    /** One notification, on one channel. Cancelled by its own id rather than
     *  stacking: the latest run is the one somebody wants to read. */
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
            // The permission was refused. Not worth a crash: the run happened,
            // and the history inside the app still has every word of it.
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
        throw Silent(R.string.notify_failed_no_engine)
    }

    /**
     * A failure this app already has words for, in the phone's language.
     *
     * Everything below a notification is written in English - an exception
     * message, an HTTP error, a line out of the engine - and that is right for
     * a log and wrong for a person: "Abgleich fehlgeschlagen" appeared on a
     * phone in German with "the engine did not answer within thirty seconds"
     * underneath it. A message this app AUTHORED has no excuse for that, and it
     * carries a string resource instead so the notification can say it the way
     * everything else on the screen is said.
     *
     * The English text stays as the exception's own message, because the log
     * line is read by whoever is debugging rather than by whoever is syncing.
     *
     * Reasons that come out of the ENGINE are a different problem and not
     * solved here: they are sentences composed in Go, and translating them
     * means giving them codes first.
     */
    private class Silent(val said: Int) : IllegalStateException("the engine did not answer within thirty seconds")

    /**
     * What one wake-up did, as the engine reports it.
     *
     * It used to read one number out of the answer with a regular expression,
     * which was enough while the only consumer was a log line. The answer now
     * carries the whole summary because a notification has to tell "four jobs
     * copied nine files" from "four ran and one failed", and those want
     * different channels and different words.
     */
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
        // No read timeout at all. The answer arrives when the copying has
        // finished, and a cap here would be this program deciding how long
        // somebody's photos are allowed to take.
        call.readTimeout = 0
        OutputStreamWriter(call.outputStream).use { it.write("{}") }
        val body = call.inputStream.bufferedReader().readText()
        call.disconnect()

        // A real parser rather than another regular expression. `reason` is a
        // sentence from the engine and can hold a brace, a quote or a path, and
        // a pattern would have to be right about all three.
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
     * Three channels, so Android's own notification page has something to say.
     *
     * jdp: "gibt es nicht unterschiedliche benachrichtigungskanäle? Wie Motor,
     * Sync ereignisse, fehler, Erfolg, etc die man in native android kanäle
     * aufteilen kann?" There is, and it pairs with the link this app now has
     * into that page: with a single channel that page is one switch, which is
     * the same as having no page at all. Split like this, somebody can leave
     * the failures loud and silence the rest, or the other way round, without
     * the app needing a single setting of its own.
     *
     * Three rather than the five somebody could name, because a channel with
     * nothing behind it is a switch that does nothing. These are exactly what
     * the app can say: it is working, it finished, it failed.
     *
     * The IMPORTANCES are the design. The engine's own is LOW because a
     * foreground service must show something and nobody wants a chime for a
     * folder syncing. A finished run is LOW too - it is a receipt, not news.
     * A FAILED run is DEFAULT, and it is the only one that makes a sound,
     * because it is the only one somebody has to do something about.
     *
     * A channel's importance cannot be changed after it exists - Android makes
     * that the person's to set, deliberately - so these are the starting points
     * and their page is where they are tuned.
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
        /** One channel per thing the app can say. See `channel()`. */
        const val CHANNEL_DONE = "done"
        const val CHANNEL_FAILED = "failed"
        const val NOTIFICATION_ID = 1
        /** Own ids, so the latest finished run REPLACES the previous one rather
         *  than stacking: a shade holding nine identical receipts is a shade
         *  somebody swipes clear without reading. */
        const val DONE_ID = 2
        const val FAILED_ID = 3
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
