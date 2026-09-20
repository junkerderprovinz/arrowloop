package design.halleluja.arrowloop

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.provider.MediaStore
import android.util.Log

/**
 * Registers the Android jobs that wake the app, so no foreground service and
 * no permanent notification are needed. The jobs only say "now is a good
 * time"; the engine decides from its own cron expressions which jobs are due.
 * The timer fires every fifteen minutes, and the content trigger fires when
 * the media store changes, such as when the camera takes a photo.
 */
object Waker {

    private const val TAG = "ArrowLoop"

    /** Fixed ids, so re-arming replaces the jobs rather than adding more. */
    private const val TIMER = 1
    private const val WATCH = 2

    /** Android's minimum period; a shorter one is rounded up to this. */
    private const val EVERY_MS = 15L * 60L * 1000L

    /**
     * Lets a burst of changes settle before running, since a camera writes a
     * photo and its thumbnail as two notifications.
     */
    private const val SETTLE_MS = 30L * 1000L
    private const val SETTLE_MAX_MS = 5L * 60L * 1000L

    fun arm(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        val service = ComponentName(context, SyncJobService::class.java)

        scheduler.schedule(
            JobInfo.Builder(TIMER, service)
                .setPeriodic(EVERY_MS)
                // No charging or network constraints: the engine enforces the
                // person's own conditions, and a second check here could
                // disagree with it and keep the schedule from ever firing.
                .setPersisted(true)
                .build(),
        )

        scheduler.schedule(
            JobInfo.Builder(WATCH, service)
                .addTriggerContentUri(
                    JobInfo.TriggerContentUri(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS,
                    ),
                )
                .addTriggerContentUri(
                    JobInfo.TriggerContentUri(
                        MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                        JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS,
                    ),
                )
                .setTriggerContentUpdateDelay(SETTLE_MS)
                .setTriggerContentMaxDelay(SETTLE_MAX_MS)
                // Android cannot persist a content-triggered job, so
                // BootReceiver arms it again after a reboot.
                .build(),
        )
        Log.i(TAG, "waking armed: every ${EVERY_MS / 60000} minutes, and when the camera writes")
    }

    fun disarm(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        scheduler.cancel(TIMER)
        scheduler.cancel(WATCH)
        Log.i(TAG, "waking disarmed")
    }
}
