package design.halleluja.arrowloop

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The app's one screen: the engine's own interface, in a WebView.
 *
 * Not a second interface written in Kotlin. ArrowLoop's screens are forty-two
 * languages of a design language that already exists, and a phone-shaped
 * rewrite of them would be a second thing to keep in step with the first -
 * which is how two interfaces end up disagreeing about what a job is. The
 * engine serves its own interface on loopback and this shows it.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var waiting: View
    private lateinit var trouble: TextView

    /**
     * Asked for at the moment it MEANS something, not at launch.
     *
     * On Android 13 and up a foreground service without this permission still
     * runs and its notification is silently dropped - so a sync would be going
     * with nothing on screen saying so, which is exactly the state a foreground
     * service exists to prevent. Refusing is allowed; the engine still runs,
     * and the only thing lost is the row in the shade.
     */
    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        waiting = findViewById(R.id.waiting)
        trouble = findViewById(R.id.trouble)

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        // No file or content access from the page. The interface is served over
        // loopback and has no business reading the phone's filesystem through
        // the WebView: everything it needs comes from the engine's own API.
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                waiting.visibility = View.GONE
                web.visibility = View.VISIBLE
            }
        }

        // The system back button walks the interface's own history before it
        // leaves the app. Without this, one tap out of a job's editor closes
        // ArrowLoop, which is the single most reported thing about any app
        // wrapped this way.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        EngineService.start(this)
        waitForEngine()
    }

    /**
     * Wait for the engine to answer before loading its address.
     *
     * A WebView pointed at a port nothing is listening on shows its own error
     * page - "ERR_CONNECTION_REFUSED" over a Chrome logo - and that page is
     * what somebody would report as the app being broken. The engine takes a
     * second or two to open its port on a cold start, and the honest thing to
     * put on screen meanwhile is a line saying so.
     */
    private fun waitForEngine() {
        CoroutineScope(Dispatchers.Main).launch {
            repeat(60) {
                if (withContext(Dispatchers.IO) { Engine.answers() }) {
                    web.loadUrl(Engine.ORIGIN)
                    return@launch
                }
                delay(500)
            }
            // Thirty seconds without an answer is not slowness any more. What
            // goes on screen is the engine's own log, because the reason is in
            // it and a person with a broken app deserves the reason rather than
            // a shrug.
            waiting.visibility = View.GONE
            trouble.visibility = View.VISIBLE
            trouble.text = getString(R.string.engine_silent, lastLines())
        }
    }

    private fun lastLines(): String = try {
        java.io.File(Engine.home(this), "engine.log").readLines().takeLast(12).joinToString("\n")
    } catch (_: Exception) {
        ""
    }
}
