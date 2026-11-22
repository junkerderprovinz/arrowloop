package arrowloop.halleluja.design

import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URL

/**
 * The start StartJob.post sends, against a server that answers as the
 * engine's guard (internal/web/guard.go) and runJob in internal/web/api.go do.
 * TestThePhoneStartsAJobAsItsPluginDoes holds the Go side of the same request.
 */
class StartJobPostTest {

    private val seen = mutableListOf<String>()

    private val engine = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { exchange ->
            val kind = exchange.requestHeaders.getFirst("Content-Type")?.substringBefore(';')?.trim()
            val body = exchange.requestBody.readBytes().decodeToString()
            seen += "${exchange.requestMethod} ${exchange.requestURI.path} $kind $body"
            // A change sent as anything but JSON is refused, since a browser
            // sends a form to any site without asking first.
            val code = if (exchange.requestMethod != "GET" && kind != "application/json") 415 else 202
            exchange.sendResponseHeaders(code, -1)
            exchange.close()
        }
        start()
    }

    @After
    fun stop() = engine.stop(0)

    private fun open(path: String) =
        URL("http://127.0.0.1:${engine.address.port}$path").openConnection() as HttpURLConnection

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
