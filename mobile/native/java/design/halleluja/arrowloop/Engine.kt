package design.halleluja.arrowloop

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The engine process: starting it, knowing whether it answers, stopping it.
 *
 * This is the same binary the container and the desktop build run. Nothing here
 * is an Android port of the sync logic - there is one engine, and this file is
 * the thing that gives it a working directory and a port on a phone.
 */
object Engine {

    private const val TAG = "ArrowLoop"

    /**
     * Loopback only, and that is not a default anybody should change.
     *
     * The engine has no login of its own: on a home server it sits behind the
     * network the server is on, and on a phone there is no such boundary. Bound
     * to 127.0.0.1 it is reachable by this app and by nothing else, not even by
     * another app on the same phone that lacks the INTERNET permission - and
     * never by anybody on the same wifi.
     */
    const val ADDRESS = "127.0.0.1:8422"
    const val ORIGIN = "http://$ADDRESS"

    @Volatile
    private var process: Process? = null

    /**
     * Where the engine's own binary lives, and why it is not where you would
     * look for it.
     *
     * Since Android 10 an app may not execute a file out of its own data
     * directory - W^X is enforced, and a binary copied to `filesDir` fails with
     * "Permission denied" no matter what mode it carries. The one directory
     * left is the native library directory, whose contents the installer marks
     * executable, and only files matching `lib*.so` are put there.
     *
     * So the engine ships as `libarrowloop.so`. It is a program, not a library;
     * the name is what the packaging demands, and calling it anything else
     * produces an app that installs cleanly and cannot start.
     */
    fun binary(context: Context): File =
        File(context.applicationInfo.nativeLibraryDir, "libarrowloop.so")

    /** The engine's own folder: its configuration, its state and its log. */
    fun home(context: Context): File =
        File(context.filesDir, "engine").apply { mkdirs() }

    private fun config(context: Context): File = File(home(context), "arrowloop.json")

    /**
     * Write a configuration if there is none yet.
     *
     * An EMPTY job list rather than an invented job. The engine refuses to
     * start on a file it cannot parse, and a made-up job pointing at a folder
     * nobody chose would be worse than that: it would run.
     */
    fun ensureConfig(context: Context) {
        val file = config(context)
        if (file.exists() && file.length() > 0) return
        file.writeText("""{"jobs":[]}""")
        Log.i(TAG, "wrote a starting configuration at ${file.absolutePath}")
    }

    /**
     * Whether the process we started is still running.
     *
     * The one thing a log cannot say by itself. An empty log means either
     * "died before it could write" or "still going and simply not answering
     * yet", and those want opposite next steps - the first is a crash to
     * diagnose, the second is a timeout to lengthen. Asking the process is the
     * only way to tell them apart.
     */
    fun alive(): Boolean = process?.isAlive == true

    /** Whether the engine is up and answering, rather than merely spawned. */
    fun answers(timeoutMs: Int = 1500): Boolean = try {
        val connection = URL("$ORIGIN/api/capabilities").openConnection() as HttpURLConnection
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs
        connection.requestMethod = "GET"
        val code = connection.responseCode
        connection.disconnect()
        code in 200..499
    } catch (_: Exception) {
        false
    }

    /**
     * Start it, unless it is already answering.
     *
     * Answering rather than "did we start it": the service can be recreated
     * while the process it started is still alive - the system restarts a
     * service far more readily than it kills a child process - and starting a
     * second engine on the same port gives one that exits immediately and one
     * that keeps the port, with the log full of a bind error nobody caused.
     */
    /**
     * Everything that goes wrong goes in the LOG, not only in logcat.
     *
     * This is what the trouble screen reads, and it was empty on the first
     * phone this was ever installed on - the screen said the engine had not
     * answered and then showed nothing, because every way of failing before
     * the process exists writes to logcat, which nobody holding a phone can
     * see. A diagnostic only the developer can read is not a diagnostic.
     */
    private fun note(context: Context, line: String) {
        try {
            File(home(context), "engine.log").appendText(line + "\n")
        } catch (_: Exception) {
            // Nothing left to try: if the app cannot write its own files
            // directory, the log is the least of it.
        }
        Log.i(TAG, line)
    }

    @Synchronized
    /**
     * Start it, and report whether THIS call is the one that did.
     *
     * The answer matters because two things start the engine now: the screens,
     * while somebody is looking at them, and the wake-up service, while a
     * scheduled run is happening. Whichever arrives second must not stop the
     * process the first one is using - a wake-up that fired while the app was
     * open used to kill the engine underneath it, and the screens went blank
     * mid-tap with "the engine exited with code 143" in the log.
     */
    fun start(context: Context): Boolean {
        if (answers()) {
            Log.i(TAG, "engine already answering on $ADDRESS")
            return false
        }
        try {
            File(home(context), "engine.log").writeText("")
        } catch (_: Exception) {
        }
        val binary = binary(context)
        if (!binary.exists()) {
            note(context, "no engine at ${binary.absolutePath} - this build shipped without one")
            return false
        }
        // Named in the log because all of it has been the answer at some point:
        // a file that is there and not executable, a build whose engine is for
        // a different architecture than the phone, and - three times now - a
        // screenshot from the emulator when the question was about the phone.
        //
        // `builtFor` is the last of those and the reason this line grew. The
        // architecture is in the path: the installer puts the engine in a
        // folder named after the ABI it was packaged for. Without it, telling
        // an emulator's arm64 run from a phone's meant recognising the file
        // SIZE, which is not something anybody should have to do twice.
        val builtFor = binary.parentFile?.name ?: "?"
        note(
            context,
            "starting ${binary.name} built for ${builtFor}, ${binary.length()} bytes, " +
                "executable=${binary.canExecute()}, device=${Build.SUPPORTED_ABIS.joinToString(",")}",
        )
        ensureConfig(context)

        // Fresh each start. Appending forever means the trouble screen shows
        // the last twelve lines of whatever run happened to end last, which on
        // a second attempt is the PREVIOUS failure - the most misleading thing
        // a diagnostic can do is describe a problem that is already fixed.
        val log = File(home(context), "engine.log")
        val builder = ProcessBuilder(
            binary.absolutePath, "web", "-config", config(context).absolutePath,
        )
        builder.directory(home(context))
        builder.environment()["ARROWLOOP_ADDR"] = ADDRESS
        // HOME is where rclone looks for its own configuration, and without it
        // the engine would write the remotes somewhere that is not this app's.
        builder.environment()["HOME"] = home(context).absolutePath
        builder.environment()["TMPDIR"] = context.cacheDir.absolutePath
        builder.redirectErrorStream(true)
        builder.redirectOutput(ProcessBuilder.Redirect.appendTo(log))

        process = try {
            builder.start()
        } catch (e: Exception) {
            note(context, "the engine would not start: ${e.javaClass.simpleName}: ${e.message}")
            null
        }

        // A process that has ALREADY exited is the case the trouble screen
        // could say nothing about: killed by a signal it could not write a
        // traceback for, the log stays empty, and the screen reports thirty
        // seconds of silence without a reason. Watched on its own thread so
        // nothing here blocks the service's start.
        val started = process ?: return false
        Thread {
            val code = try {
                started.waitFor()
            } catch (_: InterruptedException) {
                return@Thread
            }
            // 0 is the engine having been asked to stop, which is not a fault.
            if (code != 0) {
                // Above 128 the process was killed by a signal, and the number
                // names which: 139 is SIGSEGV, 159 is SIGSYS - the one Android
                // sends for a system call its seccomp filter forbids.
                val why = if (code > 128) " (killed by signal ${code - 128})" else ""
                note(context, "the engine exited with code $code$why")
            }
        }.apply { isDaemon = true }.start()
        return true
    }

    /**
     * Stop it, and mean it.
     *
     * `destroy()` sends SIGTERM, which the engine handles: it finishes writing
     * whatever row it is in the middle of and closes its databases. Killing it
     * outright would leave a state database mid-write, and the next run would
     * then have to decide what a half-written record means.
     */
    @Synchronized
    fun stop() {
        process?.destroy()
        process = null
    }
}
