package design.halleluja.arrowloop

import android.app.Application

/**
 * Starts nothing. The process is also created for broadcasts and scheduled
 * jobs, and from Android 12 starting a foreground service from the background
 * throws. The service is started by opening the app and by a reboot with a job
 * configured.
 */
class ArrowLoopApp : Application()
