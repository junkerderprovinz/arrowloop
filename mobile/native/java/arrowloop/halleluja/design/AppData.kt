package arrowloop.halleluja.design

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Environment
import android.os.IBinder
import android.util.Base64
import android.util.Log
import rikka.shizuku.Shizuku
import rikka.shizuku.ShizukuProvider
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Android/data, whose folders Android 11 and later show only to the app each
 * one belongs to. The engine reaches them through `arrowloop serve-data` (see
 * internal/appdata), the same binary started with more rights: through su as
 * root, which writes and hands each new file to its app, or through Shizuku
 * as the adb shell user, which only reads, since a file the shell wrote would
 * belong to the shell and its app could no longer open it.
 *
 * The engine learns of the server from its environment when it starts, so
 * switching this on or off starts the engine over. The server lives as long
 * as the engine does.
 */
object AppData {

    /** How things stand, under the names src/engine.ts uses. */
    enum class State(val js: String) {
        OFF("off"),
        ROOT("root"),
        SHIZUKU("shizuku"),
        NO_WAY("noWay"),
        SHIZUKU_STOPPED("shizukuStopped"),
        SHIZUKU_DENIED("shizukuDenied"),
        FAILED("failed"),
    }

    private const val TAG = "ArrowLoop"
    private const val PREFS = "appdata"
    private const val ENABLED = "enabled"
    private const val ROOTED = "rooted"
    private const val PASSWORD = "password"
    private const val HOST_KEY = "hostKey"
    private const val ASK = 8424

    /** Magisk gives the person ten seconds to answer its first prompt. */
    private const val SU_WAIT_S = 12L

    private enum class Way { SU, SHIZUKU }

    private class Server(
        val port: Int,
        val way: Way,
        val writes: Boolean,
        /** Blocks until the server is gone and returns its last words. */
        val await: () -> String,
        val stop: () -> Unit,
    )

    @Volatile
    private var server: Server? = null

    /** Why there is no server although it is switched on. */
    @Volatile
    private var why = State.OFF

    /** Whether the server already died once since it was switched on. */
    private var restarted = false

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun enabled(context: Context) = prefs(context).getBoolean(ENABLED, false)

    /**
     * Starts the server if it is switched on and not up, starts the engine
     * over when it did, and reports how things stand. The screens call this
     * whenever they look, which is how a Shizuku started or allowed in the
     * meantime gets noticed.
     */
    fun settle(context: Context): State {
        if (launchIfWanted(context)) Engine.restart(context)
        if (!enabled(context)) return State.OFF
        val now = server ?: return why
        return if (now.writes) State.ROOT else State.SHIZUKU
    }

    fun setEnabled(context: Context, on: Boolean): State {
        synchronized(this) {
            // Asked again on switching on, since root may have come or gone.
            prefs(context).edit().putBoolean(ENABLED, on).remove(ROOTED).apply()
            stop()
            why = State.OFF
            restarted = false
        }
        if (on) return settle(context)
        Engine.restart(context)
        return State.OFF
    }

    /** The variables that make the engine offer the Android target; empty without a server. */
    fun environment(context: Context): Map<String, String> {
        launchIfWanted(context)
        val now = server ?: return emptyMap()
        return secrets(context) + ("ARROWLOOP_DATA_ADDR" to "127.0.0.1:${now.port}")
    }

    /** Stops the server. Engine.stop calls this, since nothing else uses it. */
    @Synchronized
    fun stop() {
        val running = server ?: return
        server = null
        running.stop()
    }

    /**
     * Asks Shizuku for its permission and reports how things stand once the
     * person has answered. After "deny and don't ask again" Shizuku shows no
     * dialog, so its app is opened instead, where the permission can be given.
     */
    fun askShizuku(context: Context, then: (State) -> Unit) {
        // Settling may wait for su, Shizuku and the engine, and Shizuku
        // answers on the main thread.
        val answer = { Thread { then(settle(context)) }.start() }
        try {
            if (Shizuku.shouldShowRequestPermissionRationale()) {
                context.packageManager.getLaunchIntentForPackage(ShizukuProvider.MANAGER_APPLICATION_ID)
                    ?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                answer()
                return
            }
            Shizuku.addRequestPermissionResultListener(object : Shizuku.OnRequestPermissionResultListener {
                override fun onRequestPermissionResult(requestCode: Int, grantResult: Int) {
                    if (requestCode != ASK) return
                    Shizuku.removeRequestPermissionResultListener(this)
                    answer()
                }
            })
            Shizuku.requestPermission(ASK)
        } catch (e: RuntimeException) {
            // Shizuku stopped between the screen showing the button and the tap.
            Log.w(TAG, "could not ask Shizuku: ${e.message}")
            answer()
        }
    }

    @Synchronized
    private fun launchIfWanted(context: Context): Boolean =
        enabled(context) && server == null && why != State.FAILED && launch(context, freePort(), null)

    /**
     * Starts the server on port, the way given or the best one there is, and
     * records why when it cannot.
     */
    private fun launch(context: Context, port: Int, way: Way?): Boolean {
        val started = try {
            when (way ?: pick(context) ?: return false) {
                Way.SU -> withSu(context, port)
                Way.SHIZUKU -> withShizuku(context, port)
            }
        } catch (e: Exception) {
            note(context, "Android/data: the server would not start: ${e.javaClass.simpleName} ${e.message}")
            why = State.FAILED
            return false
        }
        if (!listening(port)) {
            started.stop()
            note(context, "Android/data: the server never took a connection on port $port")
            why = State.FAILED
            return false
        }
        server = started
        watch(context, started)
        return true
    }

    /** Root if su gives it, then Shizuku; otherwise records why neither. */
    private fun pick(context: Context): Way? {
        val prefs = prefs(context)
        if (!prefs.contains(ROOTED)) prefs.edit().putBoolean(ROOTED, probeRoot()).apply()
        // Kept rather than asked on every start, since Magisk shows a toast
        // each time it grants.
        if (prefs.getBoolean(ROOTED, false)) return Way.SU
        val shizuku = shizuku(context)
        if (shizuku == State.SHIZUKU) return Way.SHIZUKU
        why = shizuku
        return null
    }

    private fun probeRoot(): Boolean = try {
        val su = ProcessBuilder("su", "-c", "id").redirectErrorStream(true).start()
        if (su.waitFor(SU_WAIT_S, TimeUnit.SECONDS)) {
            su.inputStream.bufferedReader().readText().contains("uid=0")
        } else {
            su.destroy()
            false
        }
    } catch (_: IOException) {
        // No su on this phone.
        false
    }

    /** SHIZUKU when Shizuku can start the server, otherwise the reason it cannot. */
    private fun shizuku(context: Context): State {
        if (!Shizuku.pingBinder()) {
            if (!installed(context)) return State.NO_WAY
            if (!awaitBinder()) return State.SHIZUKU_STOPPED
        }
        // Before version 11 Shizuku spoke a protocol this API cannot.
        if (Shizuku.isPreV11()) return State.NO_WAY
        return if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) {
            State.SHIZUKU
        } else {
            State.SHIZUKU_DENIED
        }
    }

    private fun installed(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(ShizukuProvider.MANAGER_APPLICATION_ID, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    /**
     * Waits a moment for Shizuku's binder, which ShizukuProvider receives
     * shortly after the process starts, and a wake-up starts the engine at
     * once.
     */
    private fun awaitBinder(): Boolean {
        val arrived = CountDownLatch(1)
        val listener = Shizuku.OnBinderReceivedListener { arrived.countDown() }
        Shizuku.addBinderReceivedListenerSticky(listener)
        arrived.await(3, TimeUnit.SECONDS)
        Shizuku.removeBinderReceivedListener(listener)
        return Shizuku.pingBinder()
    }

    private fun withSu(context: Context, port: Int): Server {
        val su = ProcessBuilder("su")
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.appendTo(log(context)))
            .start()
        // The secrets go through su's input rather than its command line,
        // which other processes can read. The server then keeps that input
        // open as its lifeline.
        val script = secrets(context).entries.joinToString("") { "export ${it.key}='${it.value}'\n" } +
            "exec " + command(context, port, writes = true).joinToString(" ") { "'$it'" } + "\n"
        su.outputStream.write(script.toByteArray())
        su.outputStream.flush()
        return Server(
            port, Way.SU, writes = true,
            await = { "the server exited with code ${su.waitFor()}" },
            stop = {
                su.outputStream.close()
                su.destroy()
            },
        )
    }

    private fun withShizuku(context: Context, port: Int): Server {
        val args = Shizuku.UserServiceArgs(ComponentName(context, DataService::class.java))
            .daemon(false)
            .processNameSuffix("data")
            .debuggable(BuildConfig.DEBUG)
            .version(BuildConfig.VERSION_CODE)
        val bound = CountDownLatch(1)
        var binder: IBinder? = null
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                binder = service
                bound.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName?) {}
        }
        Shizuku.bindUserService(args, connection)
        if (!bound.await(10, TimeUnit.SECONDS)) {
            Shizuku.unbindUserService(args, connection, true)
            throw IllegalStateException("Shizuku did not start the service")
        }
        val service = binder!!
        // A Shizuku started as root runs the service as root as well.
        val writes = Shizuku.getUid() == 0
        DataService.start(service, command(context, port, writes), secrets(context))
        return Server(
            port, Way.SHIZUKU, writes,
            await = {
                try {
                    DataService.await(service)
                } catch (e: Exception) {
                    "Shizuku ended the service: ${e.message}"
                }
            },
            stop = {
                try {
                    Shizuku.unbindUserService(args, connection, true)
                } catch (_: RuntimeException) {
                    // Shizuku is gone, and the service went with it.
                }
            },
        )
    }

    private fun command(context: Context, port: Int, writes: Boolean) = listOf(
        Engine.binary(context).absolutePath,
        "serve-data",
        "-addr", "127.0.0.1:$port",
        "-root", File(Environment.getExternalStorageDirectory(), "Android/data").path,
        if (writes) "-adopt" else "-read-only",
        "-exit-on-eof",
    )

    /**
     * Starts a server that died on the same port once, so the target the
     * engine holds stays good. A second death is reported.
     */
    private fun watch(context: Context, watched: Server) {
        Thread {
            val said = watched.await()
            synchronized(this) {
                if (server !== watched) return@Thread
                server = null
                note(context, "Android/data: $said")
                if (restarted) {
                    why = State.FAILED
                    return@Thread
                }
                restarted = true
                launch(context, watched.port, watched.way)
            }
        }.apply { isDaemon = true }.start()
    }

    /** Waits for the server to take connections, which takes it a second or two. */
    private fun listening(port: Int): Boolean {
        repeat(50) {
            try {
                Socket().use { it.connect(InetSocketAddress(InetAddress.getLoopbackAddress(), port), 200) }
                return true
            } catch (_: IOException) {
                Thread.sleep(200)
            }
        }
        return false
    }

    /** A free port. The kernel takes it from its ephemeral range, far above the engine's. */
    private fun freePort(): Int = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }

    /** The password and the host key seed, drawn once and kept in the app's private storage. */
    private fun secrets(context: Context): Map<String, String> {
        val prefs = prefs(context)
        if (!prefs.contains(PASSWORD)) {
            prefs.edit()
                .putString(PASSWORD, random(32).joinToString("") { "%02x".format(it) })
                .putString(HOST_KEY, Base64.encodeToString(random(32), Base64.NO_WRAP))
                .commit()
        }
        return mapOf(
            "ARROWLOOP_DATA_PASS" to prefs.getString(PASSWORD, null)!!,
            "ARROWLOOP_DATA_HOSTKEY" to prefs.getString(HOST_KEY, null)!!,
        )
    }

    private fun random(bytes: Int) = ByteArray(bytes).also { SecureRandom().nextBytes(it) }

    private fun log(context: Context) = File(Engine.home(context), "android-data.log")

    private fun note(context: Context, line: String) {
        Log.i(TAG, line)
        try {
            log(context).appendText(line + "\n")
        } catch (_: IOException) {
            // Logcat still has it.
        }
    }
}
