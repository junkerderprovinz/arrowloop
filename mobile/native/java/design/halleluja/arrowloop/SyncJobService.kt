package design.halleluja.arrowloop

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log

/**
 * Hands a scheduled wake-up to EngineService and finishes at once. A
 * JobService runs on the main thread with a window of minutes, which a sync
 * over a mobile connection can outlast; the foreground service owns its own
 * lifetime and its notification lasts only as long as the run.
 */
class SyncJobService : JobService() {

    override fun onStartJob(params: JobParameters?): Boolean {
        Log.i("ArrowLoop", "woken by Android, handing over to the engine")
        EngineService.runDue(this)
        // No retry: the periodic job and the content trigger already reschedule.
        jobFinished(params, false)
        return false
    }

    /**
     * A run already under way in EngineService is not this job's child and
     * finishes regardless.
     */
    override fun onStopJob(params: JobParameters?): Boolean = false
}
