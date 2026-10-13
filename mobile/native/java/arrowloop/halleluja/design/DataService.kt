package arrowloop.halleluja.design

import android.os.Binder
import android.os.IBinder
import android.os.Parcel
import androidx.annotation.Keep
import java.io.IOException
import kotlin.system.exitProcess

/**
 * The Shizuku user service that starts the Android/data server. Shizuku runs
 * it in a process of its own as the adb shell user, and the server it starts
 * inherits that. It holds the server's standard input, so the server ends
 * with it (see `serve-data -exit-on-eof`), and Shizuku ends this process with
 * the app.
 *
 * Shizuku creates it by name, hence the Keep that stops R8 renaming it.
 */
@Keep
class DataService : Binder() {

    private var server: Process? = null

    /** The server's last lines, for the app's log when it stops. */
    private val said = ArrayDeque<String>()

    override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
        when (code) {
            START -> {
                start(data.createStringArrayList()!!, data.createStringArrayList()!!)
                reply?.writeNoException()
            }
            WAIT -> {
                val exit = server?.waitFor() ?: -1
                reply?.writeNoException()
                reply?.writeInt(exit)
                reply?.writeString(synchronized(said) { said.joinToString("\n") })
            }
            DESTROY -> exitProcess(0)
            else -> return super.onTransact(code, data, reply, flags)
        }
        return true
    }

    private fun start(command: List<String>, environment: List<String>) {
        val builder = ProcessBuilder(command).redirectErrorStream(true)
        for (pair in environment) {
            val (key, value) = pair.split("=", limit = 2)
            builder.environment()[key] = value
        }
        val started = try {
            builder.start()
        } catch (e: IOException) {
            // Binder carries runtime exceptions back to the caller, not IOException.
            throw IllegalStateException(e.message, e)
        }
        server = started
        Thread {
            started.inputStream.bufferedReader().forEachLine { line ->
                synchronized(said) {
                    said.addLast(line)
                    if (said.size > KEEP_LINES) said.removeFirst()
                }
            }
        }.apply { isDaemon = true }.start()
    }

    companion object {
        private const val START = IBinder.FIRST_CALL_TRANSACTION
        private const val WAIT = IBinder.FIRST_CALL_TRANSACTION + 1

        /**
         * What Shizuku sends when the app unbinds with remove set. The constant
         * in the API is restricted to Shizuku's own libraries.
         */
        private const val DESTROY = 16777115

        private const val KEEP_LINES = 20

        /**
         * Starts the server in the service behind binder. The secrets travel
         * in the environment, as `serve-data` expects.
         */
        fun start(binder: IBinder, command: List<String>, environment: Map<String, String>) {
            call(binder, START, { data ->
                data.writeStringList(command)
                data.writeStringList(environment.map { "${it.key}=${it.value}" })
            }) {}
        }

        /**
         * Blocks until the server exits and returns its last lines. It throws
         * once Shizuku has ended the service, which is also an end.
         */
        fun await(binder: IBinder): String = call(binder, WAIT, {}) { reply ->
            val exit = reply.readInt()
            "the server exited with code $exit\n${reply.readString().orEmpty()}"
        }

        private fun <T> call(binder: IBinder, code: Int, write: (Parcel) -> Unit, read: (Parcel) -> T): T {
            val data = Parcel.obtain()
            val reply = Parcel.obtain()
            try {
                write(data)
                binder.transact(code, data, reply, 0)
                reply.readException()
                return read(reply)
            } finally {
                data.recycle()
                reply.recycle()
            }
        }
    }
}
