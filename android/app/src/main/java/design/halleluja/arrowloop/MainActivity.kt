package design.halleluja.arrowloop

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import android.widget.Toast
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
 * The app's one screen: the engine's own interface in a WebView, so there is
 * one interface to keep in step rather than two.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var waiting: View
    private lateinit var trouble: TextView
    private lateinit var storage: View

    /**
     * Set by "Not now" for the rest of this launch. The panel returns on the next
     * cold start, since the engine's interface cannot see this permission and
     * offers no other way back to it.
     */
    private var storageDismissed = false

    /**
     * From Android 13 a foreground service without this permission still runs,
     * but its notification is dropped. Refusing costs only that notification.
     */
    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** Below Android 11 storage access is an ordinary runtime permission. */
    private val askLegacyStorage =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { showStorageIfNeeded() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        waiting = findViewById(R.id.waiting)
        trouble = findViewById(R.id.trouble)
        storage = findViewById(R.id.storage)
        wireStorage()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        // Everything the interface needs comes from the engine's API.
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                waiting.visibility = View.GONE
                web.visibility = View.VISIBLE
            }
        }

        // Back walks the interface's own history before it leaves the app.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // While the storage panel is up, it is what is on screen.
                if (storage.visibility == View.VISIBLE) {
                    storageDismissed = true
                    storage.visibility = View.GONE
                } else if (web.canGoBack()) {
                    web.goBack()
                } else {
                    finish()
                }
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
        askForStorageOnce()
    }

    /**
     * MANAGE_EXTERNAL_STORAGE is granted on a settings page with no result
     * callback, so it is checked again on every return.
     */
    override fun onResume() {
        super.onResume()
        showStorageIfNeeded()
    }

    private fun wireStorage() {
        findViewById<View>(R.id.storage_grant).setOnClickListener { openStorageSettings() }
        findViewById<View>(R.id.storage_later).setOnClickListener {
            storageDismissed = true
            storage.visibility = View.GONE
        }
    }

    private fun openStorageSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            askLegacyStorage.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        // Some builds refuse the per-package page, and an unhandled intent would
        // crash the app.
        try {
            startActivity(Storage.manageIntent(this))
        } catch (_: ActivityNotFoundException) {
            try {
                startActivity(Storage.manageIntentFallback())
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(this, R.string.storage_no_page, Toast.LENGTH_LONG).show()
            }
        }
    }

    /**
     * Opens the storage settings page on the first launch that finds the
     * permission missing, once per install. MANAGE_EXTERNAL_STORAGE has no
     * dialog, only a page with one switch.
     */
    private fun askForStorageOnce() {
        val prefs = getSharedPreferences("arrowloop", MODE_PRIVATE)
        if (prefs.getBoolean(ASKED_STORAGE, false)) return
        if (!Storage.possible || Storage.granted(this)) return
        prefs.edit().putBoolean(ASKED_STORAGE, true).apply()
        openStorageSettings()
    }

    private fun showStorageIfNeeded() {
        if (storageDismissed || Storage.granted(this)) {
            storage.visibility = View.GONE
            return
        }
        // Android 10 cannot grant this at all, so the panel explains why and
        // offers no button.
        if (!Storage.possible) {
            findViewById<TextView>(R.id.storage_why).setText(R.string.storage_why_ten)
            findViewById<View>(R.id.storage_grant).visibility = View.GONE
        }
        storage.visibility = View.VISIBLE
    }

    /**
     * Waits for the engine before loading its address, since a WebView pointed
     * at a closed port shows Chrome's own error page.
     */
    private fun waitForEngine() {
        CoroutineScope(Dispatchers.Main).launch {
            // A deadline rather than a count of attempts, since each poll can
            // take its own timeout.
            val until = SystemClock.elapsedRealtime() + WAIT_MS
            while (SystemClock.elapsedRealtime() < until) {
                if (withContext(Dispatchers.IO) { Engine.answers() }) {
                    web.loadUrl(Engine.ORIGIN)
                    return@launch
                }
                delay(400)
            }
            waiting.visibility = View.GONE
            trouble.visibility = View.VISIBLE
            // An empty log means either a crash before the first write or an
            // engine that is running and not answering; only the process can
            // tell which.
            val state = getString(
                if (Engine.alive()) R.string.engine_still_running else R.string.engine_gone,
            )
            trouble.text = getString(R.string.engine_silent, WAIT_MS / 1000, "$state\n\n${whatItSaid()}")
        }
    }

    private fun whatItSaid(): String = try {
        val lines = java.io.File(Engine.home(this), "engine.log").readLines()
        if (lines.isEmpty()) getString(R.string.engine_no_log)
        // A Go crash writes its reason on the first line and then hundreds of
        // lines of goroutines and registers, so the screen shows the head of the
        // log and the last line, which carries the exit code.
        else if (lines.size <= HEAD_LINES + 1) lines.joinToString("\n")
        else (lines.take(HEAD_LINES) + listOf("…", lines.last())).joinToString("\n")
    } catch (e: Exception) {
        getString(R.string.engine_no_log_because, e.javaClass.simpleName, e.message ?: "")
    }

    companion object {
        /**
         * How long the engine gets before the screen stops waiting. A cold start
         * pages in a 79 MB binary, possibly while the phone is still installing
         * it.
         */
        private const val WAIT_MS = 60_000L

        /**
         * Lines from the start of the log shown on screen: what was started, the
         * fatal line and the first frames under it.
         */
        private const val HEAD_LINES = 8

        /** Whether the storage page has been opened for this install already. */
        private const val ASKED_STORAGE = "asked.storage"
    }
}
