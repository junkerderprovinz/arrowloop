package arrowloop.halleluja.design

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
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
    const val WATCH = 2

    /** The first of a range of ids, one per job an automation app asked to start. */
    private const val START = 0x1000

    /** The extra naming the job to start, by id or StartJob.ALL. */
    const val START_JOB = "job"

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
        watch(context)
        Log.i(TAG, "waking armed: every ${EVERY_MS / 60000} minutes, and when the camera writes")
    }

    /**
     * Schedules the content trigger. It fires once, so SyncJobService calls
     * this again each time it does.
     */
    fun watch(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        val service = ComponentName(context, SyncJobService::class.java)
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
    }

    /**
     * Schedules a start an automation app asked for when Android refused the
     * foreground service. Expedited from Android 12 on, so it goes as soon as
     * Android allows, and one id per job, so asking twice starts it once.
     */
    fun startJob(context: Context, job: String) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        val service = ComponentName(context, SyncJobService::class.java)
        val extras = PersistableBundle().apply { putString(START_JOB, job) }
        val id = START + (job.hashCode() and 0xfff)
        fun builder() = JobInfo.Builder(id, service).setExtras(extras)
        // Android refuses an expedited job once the app's quota for them is
        // spent, and some versions one without any condition. The plain job
        // then needs a deadline, which an expedited one may not have.
        val fast = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && try {
            scheduler.schedule(builder().setExpedited(true).build()) == JobScheduler.RESULT_SUCCESS
        } catch (_: IllegalArgumentException) {
            false
        }
        if (fast) return
        try {
            scheduler.schedule(builder().setOverrideDeadline(0).build())
        } catch (e: RuntimeException) {
            // Android limits how many jobs an app may schedule; the start is lost.
            Log.w(TAG, "could not schedule the start of $job: ${e.message}")
        }
    }

    fun disarm(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        scheduler.cancel(TIMER)
        scheduler.cancel(WATCH)
        Log.i(TAG, "waking disarmed")
    }
}
