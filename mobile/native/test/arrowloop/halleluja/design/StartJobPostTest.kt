package arrowloop.halleluja.design

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.Collections

/**
 * The start StartJob.post sends, against a server that answers as the
 * engine's guard (internal/web/guard.go) and runJob in internal/web/api.go do.
 * TestThePhoneStartsAJobAsItsPluginDoes holds the Go side of the same request.
 * A plain socket, since the unit tests compile against Android's classes,
 * which have no HTTP server.
 */
class StartJobPostTest {

    private val seen: MutableList<String> = Collections.synchronizedList(mutableListOf())

    private val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))

    private val engine = Thread {
        try {
            while (true) socket.accept().use { answer(it) }
        } catch (_: Exception) {
            // The socket closed when the test ended.
        }
    }.apply { start() }

    private fun answer(client: Socket) {
        val input = client.getInputStream().bufferedReader()
        val (method, path) = input.readLine().split(" ")
        val headers = generateSequence { input.readLine() }.takeWhile { it.isNotEmpty() }
            .associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
        val body = CharArray(headers["content-length"]?.toInt() ?: 0).also { input.read(it) }.concatToString()
        val kind = headers["content-type"]?.substringBefore(';')?.trim()
        seen += "$method $path $kind $body"
        // A change sent as anything but JSON is refused, since a browser
        // sends a form to any site without asking first.
        val status = if (method != "GET" && kind != "application/json") "415 Unsupported Media Type" else "202 Accepted"
        client.getOutputStream().write("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
    }

    @After
    fun stop() {
        socket.close()
        engine.join(1000)
    }

    private fun open(path: String) =
        URL("http://127.0.0.1:${socket.localPort}$path").openConnection() as HttpURLConnection

    @Test
    fun `the engine's guard lets the start through`() {
        assertEquals(202, StartJob.post(open("/api/jobs/e617ca282194/run")))
    }

    @Test
    fun `the start is a JSON post to the job's run route`() {
        StartJob.post(open("/api/jobs/e617ca282194/run"))
        assertEquals(listOf("POST /api/jobs/e617ca282194/run application/json {}"), seen)
    }
}
