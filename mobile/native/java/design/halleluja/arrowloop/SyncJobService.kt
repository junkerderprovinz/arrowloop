package design.halleluja.arrowloop

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log

/**
 * What Android calls when it is time, and all it does is hand the work on.
 *
 * A JobService runs on the main thread with a window measured in minutes, and a
 * sync over a mobile connection is not reliably either of those things. So this
 * starts the foreground service and finishes immediately: the service holds its
 * own lifetime, does the work on its own thread, and stops itself when the run
 * is over.
 *
 * That is also where the notification comes from and where it goes again. It
 * exists for as long as files are actually moving and not one second longer,
 * which is the whole point of this arrangement.
 *
 * `jobFinished(params, false)` and not `true`: rescheduling is Android's own
 * job through the periodic entry and the content trigger. Asking for a retry
 * here as well would stack a second wake-up on top of the one already coming.
 */
class SyncJobService : JobService() {

    override fun onStartJob(params: JobParameters?): Boolean {
        Log.i("ArrowLoop", "woken by Android, handing over to the engine")
        EngineService.runDue(this)
        jobFinished(params, false)
        // false: nothing of this service is still running. The work lives in
        // EngineService now, which Android keeps alive on its own terms.
        return false
    }

    /**
     * Android took the job away, which happens when a condition it was waiting
     * on stopped holding.
     *
     * Nothing to undo: the foreground service is not this job's child and was
     * not stopped when this one was. A run already under way finishes, which is
     * the right answer - abandoning a half-finished copy to save a few seconds
     * of battery is the trade nobody wants made for them.
     */
    override fun onStopJob(params: JobParameters?): Boolean = false
}
