package design.halleluja.arrowloop

import android.app.Application

/**
 * Nothing happens here, and that is deliberate.
 *
 * An Application class is the tempting place to start the engine: it runs
 * before anything else and it looks like "the app starting". It is the wrong
 * place. It also runs when the system creates the process for a broadcast or a
 * scheduled job, so starting a foreground service from here means starting one
 * for reasons nobody asked about - and on Android 12 and up that throws
 * outright, because a foreground service may not be started from the
 * background.
 *
 * The service is started by the two things that genuinely mean it: somebody
 * opening the app, and the phone finishing a reboot with a job configured.
 */
class ArrowLoopApp : Application()
