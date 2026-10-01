package arrowloop.halleluja.design

import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.TimeZone
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Starts, probes and stops the engine process, the same binary the container
 * and the desktop build run.
 */
object Engine {

    private const val TAG = "ArrowLoop"

    /**
     * Loopback only, so the engine is not reachable from the network the phone
     * is on. Every other app on the phone can still reach loopback, which is
     * what the token is for.
     */
    const val ADDRESS = "127.0.0.1:8422"
    const val ORIGIN = "http://$ADDRESS"

    /** The headers the engine checks; see internal/web/guard.go. */
    private const val TOKEN_HEADER = "X-ArrowLoop-Token"
    private const val CHALLENGE_HEADER = "X-ArrowLoop-Challenge"
    private const val PROOF_HEADER = "X-ArrowLoop-Proof"

    @Volatile
    private var process: Process? = null

    @Volatile
    private var token: String? = null

    private fun randomHex(bytes: Int): String =
        ByteArray(bytes).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }

    private fun tokenFile(context: Context) = File(context.filesDir, "engine.token")

    /**
     * The secret the engine wants on every request, so that no other app can
     * drive it. It is kept in the app's private files, because an engine left
     * running by an earlier process of this app still holds the one it was
     * started with.
     */
    @Synchronized
    fun token(context: Context): String {
        token?.let { return it }
        val kept = try {
            tokenFile(context).readText().trim()
        } catch (_: Exception) {
            ""
        }
        return kept.ifEmpty { renewToken(context) }
    }

    /** Draws a new token, so one that leaked dies with the engine it was drawn for. */
    @Synchronized
    private fun renewToken(context: Context): String {
        val value = randomHex(32)
        tokenFile(context).writeText(value)
        token = value
        return value
    }

    /** Opens a connection to the engine that carries the token. */
    fun connect(context: Context, path: String): HttpURLConnection =
        (URL("$ORIGIN$path").openConnection() as HttpURLConnection).apply {
            setRequestProperty(TOKEN_HEADER, token(context))
        }

    /**
     * Returns the active network's nameservers, comma-separated, or null when
     * Android will not say. Null leaves the engine's own behaviour in place
     * rather than guessing a public resolver.
     */
    private fun nameservers(context: Context): String? {
        return try {
            val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return null
            val active = manager.activeNetwork ?: return null
            val links = manager.getLinkProperties(active) ?: return null
            val list = links.dnsServers.mapNotNull { it.hostAddress }.filter { it.isNotBlank() }
            if (list.isEmpty()) null else list.joinToString(",")
        } catch (e: Exception) {
            Log.w(TAG, "could not read the nameservers: ${e.javaClass.simpleName}")
            null
        }
    }

    /**
     * The engine binary. Android 10 and later refuse to execute files from an
     * app's data directory, so it ships in the native library directory, which
     * only accepts files named `lib*.so`.
     */
    fun binary(context: Context): File =
        File(context.applicationInfo.nativeLibraryDir, "libarrowloop.so")

    /** The engine's folder for its configuration, state and log. */
    fun home(context: Context): File =
        File(context.filesDir, "engine").apply { mkdirs() }

    private fun config(context: Context): File = File(home(context), "arrowloop.json")

    /** Writes a configuration with no jobs if there is none yet. */
    fun ensureConfig(context: Context) {
        val file = config(context)
        if (file.exists() && file.length() > 0) return
        file.writeText("""{"jobs":[]}""")
        Log.i(TAG, "wrote a starting configuration at ${file.absolutePath}")
    }

    /**
     * Reports whether the started process is still running, which tells a
     * crash from a slow start when the log is empty.
     */
    fun alive(): Boolean = process?.isAlive == true

    /**
     * Reports whether our engine answers over HTTP, rather than merely being
     * spawned. Another app could have taken the port first, so the answer has
     * to prove it knows the token, and the probe does not send the token to
     * whoever is listening.
     */
    fun answers(context: Context, timeoutMs: Int = 1500): Boolean = try {
        val challenge = randomHex(16)
        val connection = URL("$ORIGIN/api/capabilities").openConnection() as HttpURLConnection
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs
        connection.requestMethod = "GET"
        connection.setRequestProperty(CHALLENGE_HEADER, challenge)
        connection.responseCode
        val proof = connection.getHeaderField(PROOF_HEADER)
        connection.disconnect()
        proof != null && MessageDigest.isEqual(proof.toByteArray(), proofOf(token(context), challenge).toByteArray())
    } catch (_: Exception) {
        false
    }

    private fun proofOf(token: String, challenge: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(token.toByteArray(), "HmacSHA256"))
        return mac.doFinal(challenge.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    /**
     * Writes a line to the engine log as well as logcat, since the trouble
     * screen shows the engine log and nobody holding the phone can read logcat.
     */
    private fun note(context: Context, line: String) {
        try {
            File(home(context), "engine.log").appendText(line + "\n")
        } catch (_: Exception) {
            // The files directory is unwritable; logcat still gets the line.
        }
        Log.i(TAG, line)
    }

    /**
     * Starts the engine unless it is already running, and reports whether this
     * call started it. The screens and the wake-up service both start it, and
     * only the caller that started it may stop it.
     */
    @Synchronized
    fun start(context: Context): Boolean {
        // The process handle is checked first: the two callers arrive
        // milliseconds apart, and a freshly spawned engine has not bound its
        // port yet, so the HTTP probe alone would start a second engine. The
        // probe still catches an engine left running by an earlier process of
        // this app.
        process?.let {
            if (it.isAlive) {
                Log.i(TAG, "engine already started by this app, not starting a second")
                return false
            }
        }
        if (answers(context)) {
            Log.i(TAG, "engine already answering on $ADDRESS")
            return false
        }
        try {
            File(home(context), "engine.log").writeText("")
        } catch (_: Exception) {
        }
        val binary = binary(context)
        if (!binary.exists()) {
            note(context, "no engine at ${binary.absolutePath}; this build shipped without one")
            return false
        }
        // The installer puts the binary in a folder named after its ABI, which
        // tells an emulator run from a phone run in the log.
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
        builder.environment()["ARROWLOOP_APP_TOKEN"] = renewToken(context)
        // HOME is where rclone looks for its own configuration, and without it
        // the engine would write the remotes somewhere that is not this app's.
        builder.environment()["HOME"] = home(context).absolutePath
        builder.environment()["TMPDIR"] = context.cacheDir.absolutePath
        // Go cannot find either on Android: there is no /usr/share/zoneinfo, so
        // without TZ the engine runs in UTC, and no /etc/resolv.conf, so every
        // lookup goes to a resolver on localhost that does not exist. See
        // cmd/arrowloop/android.go.
        builder.environment()["TZ"] = TimeZone.getDefault().id
        nameservers(context)?.let { builder.environment()["ARROWLOOP_DNS"] = it }
        builder.redirectErrorStream(true)
        builder.redirectOutput(ProcessBuilder.Redirect.appendTo(log))

        process = try {
            builder.start()
        } catch (e: Exception) {
            note(context, "the engine would not start: ${e.javaClass.simpleName}: ${e.message}")
            null
        }

        // Logs the exit code, since an engine killed by a signal writes nothing
        // itself.
        val started = process ?: return false
        Thread {
            val code = try {
                started.waitFor()
            } catch (_: InterruptedException) {
                return@Thread
            }
            if (code != 0) {
                // Above 128 the code names the signal: 139 is SIGSEGV, 159 is
                // SIGSYS, which Android's seccomp filter sends.
                val why = if (code > 128) " (killed by signal ${code - 128})" else ""
                note(context, "the engine exited with code $code$why")
            }
        }.apply { isDaemon = true }.start()
        return true
    }

    /**
     * Sends SIGTERM, on which the engine finishes the row it is writing and
     * closes its databases.
     */
    @Synchronized
    fun stop() {
        process?.destroy()
        process = null
    }
}
