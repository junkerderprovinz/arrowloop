package arrowloop.halleluja.design

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
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
 * switching this on or off, or to another way, starts the engine over. The
 * server lives as long as the engine does.
 */
object AppData {

    /** How things stand, under the names src/engine.ts uses. */
    enum class State(val js: String) {
        OFF("off"),
        ROOT("root"),
        SHIZUKU("shizuku"),
        NO_WAY("noWay"),
        NO_SU("noSu"),
        ROOT_DENIED("rootDenied"),
        NO_SHIZUKU("noShizuku"),
        SHIZUKU_STOPPED("shizukuStopped"),
        SHIZUKU_DENIED("shizukuDenied"),
        FAILED("failed"),
    }

    enum class Way(val js: String) { SU("root"), SHIZUKU("shizuku") }

    /**
     * What the screen shows: how things stand, the way it marks as chosen,
     * which ways can work on this phone, and the su in use.
     */
    class Report(val state: State, val way: Way, val root: Boolean, val shizuku: Boolean, val su: String)

    /** What su answered when last asked for root. */
    private enum class Root { GRANTED, DENIED, ABSENT }

    private const val TAG = "ArrowLoop"
    private const val PREFS = "appdata"
    private const val ENABLED = "enabled"
    private const val WAY = "way"
    private const val ROOT = "root"
    private const val SU = "su"
    private const val PASSWORD = "password"
    private const val HOST_KEY = "hostKey"
    private const val ASK = 8424

    /** Magisk gives the person ten seconds to answer its first prompt. */
    private const val SU_WAIT_S = 12L

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

    /** The way last tried, which the screen marks while the person has picked none. */
    @Volatile
    private var tried: Way? = null

    /** Whether the running engine was given a server's address. */
    @Volatile
    private var offered = false

    /** Whether the server already died once since it was switched on. */
    private var restarted = false

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun enabled(context: Context) = prefs(context).getBoolean(ENABLED, false)

    /** The way the person picked; null leaves it to the order in choose. */
    private fun picked(context: Context): Way? =
        prefs(context).getString(WAY, null)?.let { js -> Way.values().first { it.js == js } }

    /** What runs as su. Some root managers install it under another name. */
    private fun su(context: Context): String = prefs(context).getString(SU, null) ?: "su"

    /**
     * Starts the server if it is switched on and not up, starts the engine
     * over when it did, and reports how things stand. The screens call this
     * whenever they look, which is how a Shizuku started or allowed in the
     * meantime gets noticed.
     */
    fun settle(context: Context): Report {
        if (launchIfWanted(context)) Engine.restart(context)
        return report(context)
    }

    // Asked again on switching on, since root may have come or gone.
    fun setEnabled(context: Context, on: Boolean) = again(context) { putBoolean(ENABLED, on).remove(ROOT) }

    fun setWay(context: Context, way: Way) = again(context) {
        putString(WAY, way.js)
        // Asked again on picking root, since it may have been allowed in the
        // root manager in the meantime.
        if (way == Way.SU) remove(ROOT)
    }

    fun setSu(context: Context, su: String) = again(context) { putString(SU, su).remove(ROOT) }

    /**
     * Runs su again, which makes the root manager ask the person, unless it
     * was told to remember a refusal.
     */
    fun requestRoot(context: Context) = again(context) { remove(ROOT) }

    /**
     * Stops the server, makes the change and starts the server the way now
     * wanted. An engine that holds the old server's address starts over even
     * when no new server came up, so it lets go of the address.
     */
    private fun again(context: Context, change: SharedPreferences.Editor.() -> Unit): Report {
        synchronized(this) {
            val edit = prefs(context).edit()
            edit.change()
            edit.apply()
            stop()
            why = State.OFF
            restarted = false
        }
        if (launchIfWanted(context) || offered) Engine.restart(context)
        return report(context)
    }

    private fun report(context: Context): Report {
        val now = server
        val state = when {
            !enabled(context) -> State.OFF
            now == null -> why
            now.writes -> State.ROOT
            else -> State.SHIZUKU
        }
        return Report(
            state,
            way = picked(context) ?: now?.way ?: tried ?: Way.SU,
            // Possible until su is found missing: only running su tells more,
            // and that can bring up the root manager's prompt.
            root = prefs(context).getString(ROOT, null) != Root.ABSENT.name,
            shizuku = Shizuku.pingBinder() || installed(context),
            su = su(context),
        )
    }

    /** The variables that make the engine offer the Android target; empty without a server. */
    fun environment(context: Context): Map<String, String> {
        launchIfWanted(context)
        val now = server
        offered = now != null
        if (now == null) return emptyMap()
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
    fun askShizuku(context: Context, then: (Report) -> Unit) {
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
     * Starts the server on port, the way given or the one chosen, and records
     * why when it cannot.
     */
    private fun launch(context: Context, port: Int, way: Way?): Boolean {
        val chosen = way ?: choose(context).let { (pick, refusal) ->
            tried = pick
            if (refusal != null) {
                why = refusal
                return false
            }
            pick
        }
        val started = try {
            when (chosen) {
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

    /**
     * The way to start the server, and why it cannot or null when it can:
     * the way the person picked, or without one, root if su gives it, then
     * Shizuku.
     */
    private fun choose(context: Context): Pair<Way, State?> {
        when (picked(context)) {
            Way.SU -> return Way.SU to rootRefusal(context)
            Way.SHIZUKU -> return Way.SHIZUKU to shizukuRefusal(context)
            null -> {}
        }
        val root = rootRefusal(context) ?: return Way.SU to null
        val shizuku = shizukuRefusal(context)
        if (shizuku != State.NO_SHIZUKU) return Way.SHIZUKU to shizuku
        // With neither, root is the way shown while su answers at all, so it
        // can be asked for again.
        return Way.SU to if (root == State.ROOT_DENIED) root else State.NO_WAY
    }

    /** Null when su gives root, otherwise the reason it does not. */
    private fun rootRefusal(context: Context): State? {
        val prefs = prefs(context)
        // Kept rather than asked on every start, since Magisk shows a toast
        // each time it grants.
        val root = prefs.getString(ROOT, null)?.let(Root::valueOf)
            ?: probeRoot(su(context)).also { prefs.edit().putString(ROOT, it.name).apply() }
        return when (root) {
            Root.GRANTED -> null
            Root.DENIED -> State.ROOT_DENIED
            Root.ABSENT -> State.NO_SU
        }
    }

    private fun probeRoot(su: String): Root = try {
        val process = ProcessBuilder(su, "-c", "id").redirectErrorStream(true).start()
        when {
            // Nobody answered the root manager's prompt in time.
            !process.waitFor(SU_WAIT_S, TimeUnit.SECONDS) -> {
                process.destroy()
                Root.DENIED
            }
            process.inputStream.bufferedReader().readText().contains("uid=0") -> Root.GRANTED
            else -> Root.DENIED
        }
    } catch (_: IOException) {
        // Nothing runs under that name.
        Root.ABSENT
    }

    /** Null when Shizuku can start the server, otherwise the reason it cannot. */
    private fun shizukuRefusal(context: Context): State? {
        if (!Shizuku.pingBinder()) {
            if (!installed(context)) return State.NO_SHIZUKU
            if (!awaitBinder()) return State.SHIZUKU_STOPPED
        }
        // Before version 11 Shizuku spoke a protocol this API cannot.
        if (Shizuku.isPreV11()) return State.NO_SHIZUKU
        return if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) null else State.SHIZUKU_DENIED
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
        val shell = ProcessBuilder(su(context))
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.appendTo(log(context)))
            .start()
        // The secrets go through su's input rather than its command line,
        // which other processes can read. The server then keeps that input
        // open as its lifeline.
        val script = secrets(context).entries.joinToString("") { "export ${it.key}='${it.value}'\n" } +
            "exec " + command(context, port, writes = true).joinToString(" ") { "'$it'" } + "\n"
        shell.outputStream.write(script.toByteArray())
        shell.outputStream.flush()
        return Server(
            port, Way.SU, writes = true,
            await = { "the server exited with code ${shell.waitFor()}" },
            stop = {
                shell.outputStream.close()
                shell.destroy()
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
                Socket().use { it.connect(InetSocketAddress(LOOPBACK, port), 200) }
                return true
            } catch (_: IOException) {
                Thread.sleep(200)
            }
        }
        return false
    }

    /** A free port. The kernel takes it from its ephemeral range, far above the engine's. */
    private fun freePort(): Int = ServerSocket(0, 1, LOOPBACK).use { it.localPort }

    // The server listens on IPv4, and Android's getLoopbackAddress() is ::1.
    private val LOOPBACK: InetAddress = InetAddress.getByName("127.0.0.1")

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
