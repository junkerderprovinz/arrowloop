package design.halleluja.arrowloop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * The engine, kept alive while the app is not on screen.
 *
 * A sync tool that only works while somebody is looking at it is a file
 * manager. The whole reason this is a service is the case nobody watches: the
 * phone in a pocket on a train, syncing what the camera made this morning.
 *
 * `dataSync` is the declared type, and it is the honest one - this moves files
 * between two places on somebody's behalf. It also carries the rules that come
 * with it: since Android 14 a dataSync service is capped at six hours in a day,
 * and since 15 it can be timed out sooner. That is not a limitation to work
 * around, it is the budget the app has to live inside, and the emulator this
 * was developed against runs Android 16 precisely so those rules are the ones
 * being tested.
 */
class EngineService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        channel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Engine.stop()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
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

        Engine.start(this)

        // Watching for the charger and the connection starts with the service
        // rather than with the screens, because the hours this matters in are
        // the ones with no screen: JavaScript can be torn down while this
        // carries on, and a watcher that lived there would go quiet exactly
        // when the phone went into a pocket.
        Device.watch(this)

        // START_STICKY: if the system reclaims this service under memory
        // pressure, bring it back. Engine.start checks whether the engine is
        // already answering, so a restart that finds the process still alive
        // does nothing rather than starting a second one.
        return START_STICKY
    }

    override fun onDestroy() {
        Device.forget(this)
        Engine.stop()
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
            // not let go. This one stops the engine and means it.
            .addAction(0, getString(R.string.notify_stop), stop)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    companion object {
        const val CHANNEL = "engine"
        const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "design.halleluja.arrowloop.STOP"

        fun start(context: android.content.Context) {
            val intent = Intent(context, EngineService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
