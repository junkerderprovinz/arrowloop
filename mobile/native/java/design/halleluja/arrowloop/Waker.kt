package design.halleluja.arrowloop

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.provider.MediaStore
import android.util.Log

/**
 * Who wakes this app up, now that nothing of ours stays awake.
 *
 * The engine used to be held alive by a foreground service around the clock,
 * which on Android means a notification in the shade around the clock. jdp:
 * "die app soll keine dauerhafte benachrichtigung haben." There is no flag that
 * hides it - a foreground service must show one - so the fix is not to have one
 * running, and that means something else has to do the waking.
 *
 * ANDROID DOES THE WAKING; THE ENGINE KEEPS THE SCHEDULE. Two jobs are
 * registered here, and neither knows anything about what will be run: they say
 * "now would be a good time", the engine works out which of its jobs that
 * applies to, from the cron expression the person actually wrote. One
 * definition of when a job runs, not a copy of it in Kotlin drifting away from
 * the one in the configuration file.
 *
 *   - The TIMER fires periodically. Android's floor is fifteen minutes and it
 *     is a floor for everybody; a job set for three in the morning runs within
 *     a quarter of an hour of three, which is what every background scheduler
 *     on this platform gives you.
 *
 *   - The CONTENT TRIGGER fires when the media store changes, which is what a
 *     camera does when it takes a photo. This is the piece that makes "sync it
 *     straight away" work with nothing of ours running: `addTriggerContentUri`
 *     is Android's own offer to watch on an app's behalf, and it costs no
 *     process, no wake lock and no notification.
 */
object Waker {

    private const val TAG = "ArrowLoop"

    /** Two ids, fixed, so re-arming replaces rather than accumulates. */
    private const val TIMER = 1
    private const val WATCH = 2

    /** Android's own floor for a periodic job. Asking for less is silently
     *  rounded up to this, so it is written down rather than discovered. */
    private const val EVERY_MS = 15L * 60L * 1000L

    /**
     * How long to let a burst of changes settle before running.
     *
     * A camera that writes a photo and then its thumbnail produces two content
     * notifications a fraction of a second apart, and a phone that started a
     * sync for each of them would be syncing twice for one picture. Thirty
     * seconds of quiet, up to five minutes of waiting, which is the same shape
     * as the engine's own quiet period and for the same reason.
     */
    private const val SETTLE_MS = 30L * 1000L
    private const val SETTLE_MAX_MS = 5L * 60L * 1000L

    fun arm(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        val service = ComponentName(context, SyncJobService::class.java)

        scheduler.schedule(
            JobInfo.Builder(TIMER, service)
                .setPeriodic(EVERY_MS)
                // Both conditions are deliberately NOT set here.
                //
                // "Only while charging" and "only on wifi" are the person's own
                // settings, and they are already enforced where every other
                // condition is: in the engine, through the hold it is told
                // about. Setting them here as well would be a second place that
                // decides whether a run may go ahead, and the two would
                // disagree the first time one of them changed - with the
                // symptom being a schedule that quietly never fires.
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
                // A content-triggered job cannot be persisted across a reboot -
                // Android refuses the combination - so BootReceiver arms it
                // again, which is the whole of what that receiver now does.
                .build(),
        )
        Log.i(TAG, "waking armed: every ${EVERY_MS / 60000} minutes, and when the camera writes")
    }

    /** Take the waking away, for an app with nothing set up to run. */
    fun disarm(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        scheduler.cancel(TIMER)
        scheduler.cancel(WATCH)
        Log.i(TAG, "waking disarmed")
    }
}
