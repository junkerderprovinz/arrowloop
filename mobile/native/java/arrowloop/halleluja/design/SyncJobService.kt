package arrowloop.halleluja.design

import android.app.job.JobParameters
import android.app.job.JobService
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log

/**
 * Hands a scheduled wake-up to EngineService and finishes at once. A job gets
 * a window of minutes, which a sync over a mobile connection can outlast; the
 * foreground service owns its own lifetime and its notification lasts only as
 * long as the run. Only when Android refuses that service does the run go on
 * inside the job.
 */
class SyncJobService : JobService() {

    /** Runs going on inside their job, by job id: the two jobs can overlap. */
    private val inside = HashMap<Int, Inside>()

    private val main = Handler(Looper.getMainLooper())

    override fun onStartJob(params: JobParameters): Boolean {
        Log.i(TAG, "woken by Android, handing over to the engine")
        try {
            EngineService.runDue(this)
            // No retry: the periodic job comes round again, and the content
            // trigger is scheduled anew.
            rearm(params)
            return false
        } catch (e: IllegalStateException) {
            // Android 12 and later refuse a foreground service started from
            // the background unless the app is exempt from battery
            // optimisation. The run then goes on inside this job, for as long
            // as Android gives it.
            Log.i(TAG, "running inside the job, since Android refused the service: ${e.message}")
        }
        val run = Inside(params)
        if (!bindService(Intent(this, EngineService::class.java), run, BIND_AUTO_CREATE)) {
            unbindService(run)
            rearm(params)
            return false
        }
        inside[params.jobId] = run
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        inside.remove(params.jobId)?.stop()
        return false
    }

    /** Schedules the content trigger again, since it fires only once. */
    private fun rearm(params: JobParameters) {
        if (params.jobId == Waker.WATCH) Waker.watch(this)
    }

    /** A run inside a job, which holds EngineService bound until it is over. */
    private inner class Inside(private val params: JobParameters) : ServiceConnection {

        private var binder: EngineService.Run? = null

        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val run = service as EngineService.Run
            binder = run
            // The run ends on its own thread.
            run.start { main.post { done() } }
        }

        override fun onServiceDisconnected(name: ComponentName?) {}

        private fun done() {
            if (inside[params.jobId] !== this) return
            inside.remove(params.jobId)
            unbindService(this)
            rearm(params)
            jobFinished(params, false)
        }

        fun stop() {
            binder?.stop()
            unbindService(this)
        }
    }

    private companion object {
        const val TAG = "ArrowLoop"
    }
}
