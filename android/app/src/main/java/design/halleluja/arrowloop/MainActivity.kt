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
    private lateinit var storage: View

    /**
     * Asked once per launch while the permission is missing, and not again
     * after "Not now".
     *
     * Per LAUNCH rather than once ever, and that is a deliberate re-ask: an
     * ArrowLoop that cannot leave its own private folder cannot do the thing
     * it was installed for, so somebody who dismissed this by accident has to
     * be able to get back to it, and there is nowhere else to put the way back
     * - the rest of the interface belongs to the engine, which cannot see this
     * permission at all. One tap, on a cold start, is the smallest version of
     * that which still works.
     */
    private var storageDismissed = false

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

    /**
     * Below Android 11 the reach comes from an ordinary runtime permission,
     * so it is asked for the ordinary way rather than by sending somebody to a
     * settings page that does not exist on those versions.
     */
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
                // The storage panel first: while it is up it is what is on
                // screen, and back stepping through the history of a WebView
                // nobody can see is the kind of thing that reads as the button
                // doing nothing.
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
     * Checked again on every return, because this is the one permission that is
     * granted somewhere ELSE.
     *
     * MANAGE_EXTERNAL_STORAGE has no dialog and no result callback: the person
     * leaves for a system settings page, flips a switch and comes back, and
     * nothing tells the app that happened. Re-reading it here is what makes the
     * panel disappear on its own instead of sitting there after the permission
     * was granted.
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
        // The targeted page first, the list of every app as a fallback: some
        // builds refuse the per-package form, and an unhandled intent here
        // would crash the app on the one route that is supposed to fix things.
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
     * Asked FOR you the first time, so the only thing left is the switch.
     *
     * jdp: "Können wir in der AL App nicht automatisch nach der berechtigung
     * fragen lassen so das man dann nur noch Zulassen anklicken muss?" As
     * close as Android allows, and the limit is worth writing down:
     * MANAGE_EXTERNAL_STORAGE has no dialog. It is the one permission Google
     * deliberately routed through a full settings page rather than a
     * two-button prompt, precisely because it is the broadest one there is -
     * there is no "Allow" to hand somebody, only a page with one switch on it.
     *
     * So the app opens that page itself on the first launch that finds the
     * permission missing, and the panel behind it is what you come back to if
     * you did not flip it. ONCE per install rather than every launch: a
     * settings screen that appears unbidden every time you open an app is the
     * behaviour people uninstall over.
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
        // Android 10 has no way to grant this at all. The panel still appears,
        // because somebody whose sync only sees one folder deserves to know
        // why, but it says so and offers no button that would do nothing.
        if (!Storage.possible) {
            findViewById<TextView>(R.id.storage_why).setText(R.string.storage_why_ten)
            findViewById<View>(R.id.storage_grant).visibility = View.GONE
        }
        storage.visibility = View.VISIBLE
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
            // A DEADLINE rather than a count of attempts, because the count was
            // not what it claimed. Sixty rounds of "poll, then wait half a
            // second" reads like thirty seconds and is not: the poll itself
            // could take its own timeout, so the screen said thirty and could
            // sit there for two minutes.
            val until = SystemClock.elapsedRealtime() + WAIT_MS
            while (SystemClock.elapsedRealtime() < until) {
                if (withContext(Dispatchers.IO) { Engine.answers() }) {
                    web.loadUrl(Engine.ORIGIN)
                    return@launch
                }
                delay(400)
            }
            // Silence this long is not slowness any more. What goes on screen
            // is the engine's own log, because the reason is in it and a person
            // with a broken app deserves the reason rather than a shrug.
            waiting.visibility = View.GONE
            trouble.visibility = View.VISIBLE
            trouble.text = getString(R.string.engine_silent, WAIT_MS / 1000, lastLines())
        }
    }

    private fun lastLines(): String = try {
        val lines = java.io.File(Engine.home(this), "engine.log").readLines()
        // Empty is a real answer and has to look like one. It happened on the
        // first phone this was installed on: the screen said the engine had
        // not answered and then showed nothing at all, which reads as the
        // screen being broken rather than as the engine having said nothing.
        if (lines.isEmpty()) getString(R.string.engine_no_log)
        else lines.takeLast(20).joinToString("\n")
    } catch (e: Exception) {
        getString(R.string.engine_no_log_because, e.javaClass.simpleName, e.message ?: "")
    }

    companion object {
        /** How long the engine gets before the screen stops waiting for it.
         *
         *  Sixty seconds rather than thirty, and that is measured rather than
         *  generous: the engine is a 79 MB static binary carrying every rclone
         *  backend, and a cold start has to page all of it in on a phone that
         *  may also be installing it. */
        private const val WAIT_MS = 60_000L

        /** Whether the storage page has been opened for this install already. */
        private const val ASKED_STORAGE = "asked.storage"
    }
}
