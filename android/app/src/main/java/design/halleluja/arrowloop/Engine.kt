package design.halleluja.arrowloop

import android.content.Context
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
    @Synchronized
    fun start(context: Context) {
        if (answers()) {
            Log.i(TAG, "engine already answering on $ADDRESS")
            return
        }
        val binary = binary(context)
        if (!binary.exists()) {
            Log.e(TAG, "no engine at ${binary.absolutePath} - this build shipped without one")
            return
        }
        ensureConfig(context)

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
            Log.e(TAG, "the engine would not start", e)
            null
        }
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
