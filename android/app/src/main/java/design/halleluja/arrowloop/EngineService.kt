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
 * Keeps the engine alive while the app is not on screen. As a dataSync service
 * it is capped at six hours a day from Android 14, and from 15 it can be timed
 * out sooner.
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

        // Before the work starts: a foreground service that has not called
        // startForeground within a few seconds is killed.
        startForeground(
            NOTIFICATION_ID,
            notification(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            else 0,
        )

        Engine.start(this)

        // A restart that finds the engine still answering starts no second one.
        return START_STICKY
    }

    override fun onDestroy() {
        Engine.stop()
        super.onDestroy()
    }

    private fun channel() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        val channel = NotificationChannel(
            CHANNEL,
            getString(R.string.channel_engine),
            // Visible, as a foreground service must be, but silent.
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
            // An ongoing notification needs a way to stop what it stands for.
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
