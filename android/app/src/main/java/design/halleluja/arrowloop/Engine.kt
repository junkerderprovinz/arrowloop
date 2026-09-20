package design.halleluja.arrowloop

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Starts, checks and stops the engine process, the same binary the container
 * and the desktop build run.
 */
object Engine {

    private const val TAG = "ArrowLoop"

    /**
     * The engine has no login of its own, and a phone has no trusted network
     * around it, so it is bound to loopback where nobody on the same wifi can
     * reach it.
     */
    const val ADDRESS = "127.0.0.1:8422"
    const val ORIGIN = "http://$ADDRESS"

    @Volatile
    private var process: Process? = null

    /**
     * The engine binary. Since Android 10 an app may not execute a file from its
     * data directory, so the engine ships in the native library directory, which
     * takes only files named `lib*.so`.
     */
    fun binary(context: Context): File =
        File(context.applicationInfo.nativeLibraryDir, "libarrowloop.so")

    /** The engine's own folder: its configuration, its state and its log. */
    fun home(context: Context): File =
        File(context.filesDir, "engine").apply { mkdirs() }

    private fun config(context: Context): File = File(home(context), "arrowloop.json")

    /**
     * Writes an empty job list if there is no configuration yet. The engine
     * refuses a file it cannot parse, and an invented job would run.
     */
    fun ensureConfig(context: Context) {
        val file = config(context)
        if (file.exists() && file.length() > 0) return
        file.writeText("""{"jobs":[]}""")
        Log.i(TAG, "wrote a starting configuration at ${file.absolutePath}")
    }

    /**
     * Whether the process we started is still running. An empty log alone cannot
     * tell a crash from an engine that has not answered yet.
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
     * Writes to the engine log as well as logcat, because the trouble screen
     * reads the log and nobody holding a phone can see logcat.
     */
    private fun note(context: Context, line: String) {
        try {
            File(home(context), "engine.log").appendText(line + "\n")
        } catch (_: Exception) {
            // An app that cannot write its own files directory has worse problems.
        }
        Log.i(TAG, line)
    }

    /**
     * Starts the engine unless one is already answering. The system recreates a
     * service more readily than it kills a child process, and a second engine on
     * the same port would fill the log with a bind error.
     */
    @Synchronized
    fun start(context: Context) {
        if (answers()) {
            Log.i(TAG, "engine already answering on $ADDRESS")
            return
        }
        // Fresh each start, so the trouble screen never shows a previous run's
        // failure.
        try {
            File(home(context), "engine.log").writeText("")
        } catch (_: Exception) {
        }
        val binary = binary(context)
        if (!binary.exists()) {
            note(context, "no engine at ${binary.absolutePath}; this build shipped without one")
            return
        }
        // The installer names the engine's folder after the ABI it was packaged
        // for, which tells an emulator's run from a phone's.
        val builtFor = binary.parentFile?.name ?: "?"
        note(
            context,
            "starting ${binary.name} built for ${builtFor}, ${binary.length()} bytes, " +
                "executable=${binary.canExecute()}, device=${Build.SUPPORTED_ABIS.joinToString(",")}",
        )
        ensureConfig(context)

        val log = File(home(context), "engine.log")
        val builder = ProcessBuilder(
            binary.absolutePath, "web", "-config", config(context).absolutePath,
        )
        builder.directory(home(context))
        builder.environment()["ARROWLOOP_ADDR"] = ADDRESS
        // rclone looks for its configuration under HOME.
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

        // A process killed by a signal writes no traceback, so its exit code is
        // the only reason the trouble screen can give.
        val started = process ?: return
        Thread {
            val code = try {
                started.waitFor()
            } catch (_: InterruptedException) {
                return@Thread
            }
            // 0 is the engine having been asked to stop.
            if (code != 0) {
                // 139 is SIGSEGV; 159 is SIGSYS, which Android sends for a system
                // call its seccomp filter forbids.
                val why = if (code > 128) " (killed by signal ${code - 128})" else ""
                note(context, "the engine exited with code $code$why")
            }
        }.apply { isDaemon = true }.start()
    }

    /**
     * Sends SIGTERM, which lets the engine finish the row it is writing and close
     * its databases.
     */
    @Synchronized
    fun stop() {
        process?.destroy()
        process = null
    }
}
