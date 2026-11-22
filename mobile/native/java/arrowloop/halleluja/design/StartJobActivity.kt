package arrowloop.halleluja.design

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.io.File

/**
 * The screen Tasker, MacroDroid and other Locale hosts open to set up an
 * ArrowLoop action: a list of the jobs and "All jobs", where a tap is the
 * choice. It hands the host a bundle StartJob.read accepts and a line saying
 * what the action does. It draws GlimStone's look natively, since React
 * Native's screens live in MainActivity, and takes the colours the app last
 * handed over through EngineModule.setLook.
 */
class StartJobActivity : Activity() {

    private lateinit var look: Look

    /** Whether the lock was given, which a turn of the screen keeps. */
    private var unlocked = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        look = Look.of(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.setBackgroundDrawable(ColorDrawable(look.background))
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.TRANSPARENT
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = look.light
            isAppearanceLightNavigationBars = look.light
        }

        // The app's own lock guards the job names here too.
        unlocked = savedInstanceState?.getBoolean(UNLOCKED) == true
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (look.lock && !unlocked && keyguard?.isDeviceSecure == true) {
            // Recreated while the prompt is up, the prompt's answer is still to come.
            if (savedInstanceState != null) return
            @Suppress("DEPRECATION")
            val ask = keyguard.createConfirmDeviceCredentialIntent(null, null)
            if (ask != null) {
                startActivityForResult(ask, UNLOCK)
                return
            }
        }
        show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(UNLOCKED, unlocked)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != UNLOCK) return
        if (resultCode != RESULT_OK) {
            finish()
            return
        }
        unlocked = true
        show()
    }

    private fun show() {
        val chosen = try {
            intent.getBundleExtra(StartJobReceiver.EXTRA_BUNDLE)?.getString(StartJob.KEY_JOB)
        } catch (_: Exception) {
            // A host's broken bundle only means nothing is marked as chosen.
            null
        }
        // The configuration is read off the main thread, as it can be large.
        Thread {
            val jobs = jobs(this)
            runOnUiThread { if (!isFinishing) setContentView(page(jobs, chosen)) }
        }.start()
    }

    private fun page(jobs: List<StartJob.Job>, chosen: String?): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        column.addView(text(getString(R.string.plugin_title), STATUS_SP, look.text, bold = true))
        column.addView(
            text(getString(if (jobs.isEmpty()) R.string.plugin_empty else R.string.plugin_intro), BODY_SP, look.textSub).apply {
                setPadding(0, dp(4), 0, dp(16))
            },
        )
        if (jobs.isNotEmpty()) {
            column.addView(row(getString(R.string.plugin_all), getString(R.string.plugin_all_detail), chosen == StartJob.ALL) {
                choose(StartJob.ALL, getString(R.string.plugin_blurb_all))
            })
            for (job in jobs) {
                val detail = if (job.paused) getString(R.string.plugin_paused) else null
                column.addView(row(job.name, detail, chosen == job.id) {
                    choose(job.id, getString(R.string.plugin_blurb_one, job.name))
                })
            }
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
            addView(column, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left + dp(16), bars.top + dp(24), bars.right + dp(16), bars.bottom + dp(16))
            insets
        }
        return scroll
    }

    /** A job to pick: the chosen one on the accent, the others on the card colour. */
    private fun row(title: String, detail: String?, on: Boolean, pick: () -> Unit): View {
        val fill = if (on) look.accent else look.surface
        val ink = if (on) look.ink else look.text
        val shape = GradientDrawable().apply {
            setColor(fill)
            cornerRadii = corners()
        }
        val mask = GradientDrawable().apply {
            setColor(Color.WHITE)
            cornerRadii = corners()
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            minimumHeight = dp(TOUCH_DP)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            background = RippleDrawable(ColorStateList.valueOf(look.hover), shape, mask)
            isClickable = true
            isFocusable = true
            isSelected = on
            // A tap here hands out a valid proof, so one through another app's
            // overlay does not count.
            filterTouchesWhenObscured = true
            addView(text(title, TITLE_SP, ink))
            if (detail != null) addView(text(detail, SUBLINE_SP, if (on) look.ink else look.textSub))
            setOnClickListener { pick() }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = dp(8) }
        }
    }

    /** The card's corners; the leaf shape rounds two opposite ones, mirrored right to left. */
    private fun corners(): FloatArray {
        val r = dp(look.radius).toFloat()
        if (!look.leaf) return FloatArray(8) { r }
        val rtl = resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        // Top left, top right, bottom right, bottom left, two values each.
        return if (rtl) floatArrayOf(0f, 0f, r, r, 0f, 0f, r, r) else floatArrayOf(r, r, 0f, 0f, r, r, 0f, 0f)
    }

    private fun text(value: String, sp: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    }

    private fun choose(job: String, blurb: String) {
        val bundle = Bundle().apply {
            putInt(StartJob.KEY_VERSION, StartJob.VERSION)
            putString(StartJob.KEY_JOB, job)
            putString(StartJob.KEY_PROOF, StartJob.proof(StartJobReceiver.key(this@StartJobActivity, make = true), job))
        }
        setResult(
            RESULT_OK,
            Intent().putExtra(StartJobReceiver.EXTRA_BUNDLE, bundle).putExtra(StartJobReceiver.EXTRA_BLURB, blurb),
        )
        finish()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    /**
     * GlimStone's palette for this screen, from src/theme.ts, with the look the
     * app last handed over: the theme, OLED, the accent and its ink for either
     * look, the card radius and the lock.
     */
    private class Look(
        val light: Boolean,
        val background: Int,
        val surface: Int,
        val hover: Int,
        val text: Int,
        val textSub: Int,
        val accent: Int,
        val ink: Int,
        val radius: Int,
        val leaf: Boolean,
        val lock: Boolean,
    ) {
        companion object {
            private val HEX = Regex("#[0-9a-fA-F]{6}")

            fun of(context: Context): Look {
                val saved = try {
                    JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: "{}")
                } catch (_: Exception) {
                    JSONObject()
                }
                val night = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
                val light = when (saved.optString("theme")) {
                    "light" -> true
                    "dark" -> false
                    else -> !night
                }
                val tone = saved.optJSONObject(if (light) "light" else "dark")
                fun color(value: String?, fallback: String) =
                    Color.parseColor(if (value != null && HEX.matches(value)) value else fallback)
                val accent = color(tone?.optString("accent"), DEFAULT_ACCENT)
                val ink = color(tone?.optString("ink"), DEFAULT_INK)
                val radius = saved.optInt("radius", DEFAULT_RADIUS).coerceIn(0, 32)
                val leaf = saved.optBoolean("leaf")
                val lock = saved.optBoolean("lock")
                // background, surface, hover, text, textSub
                val ramp = when {
                    light -> listOf("#f4f4f4", "#ffffff", "#e0e0e0", "#161616", "#525252")
                    saved.optBoolean("oled") -> listOf("#000000", "#161616", "#232323", "#f4f4f4", "#c6c6c6")
                    else -> listOf("#161616", "#262626", "#353535", "#f4f4f4", "#c6c6c6")
                }.map(Color::parseColor)
                return Look(light, ramp[0], ramp[1], ramp[2], ramp[3], ramp[4], accent, ink, radius, leaf, lock)
            }
        }
    }

    companion object {
        private const val TAG = "ArrowLoop"
        private const val UNLOCK = 1
        private const val UNLOCKED = "unlocked"

        /** Where EngineModule.setLook keeps what the app hands over. */
        const val PREFS = "look"
        const val KEY = "look"

        private const val DEFAULT_ACCENT = "#FCC419"
        private const val DEFAULT_INK = "#161616"
        private const val DEFAULT_RADIUS = 8

        // GlimStone's type sizes and Android's minimum touch target.
        private const val STATUS_SP = 22f
        private const val TITLE_SP = 16f
        private const val BODY_SP = 14f
        private const val SUBLINE_SP = 13f
        private const val TOUCH_DP = 48

        /** The jobs in the engine's configuration, which the picker reads without starting the engine. */
        fun jobs(context: Context): List<StartJob.Job> = try {
            val file = File(Engine.home(context), "arrowloop.json")
            val list = JSONObject(file.readText()).optJSONArray("jobs")
            StartJob.jobs(
                (0 until (list?.length() ?: 0)).mapNotNull { list!!.optJSONObject(it) }.map {
                    StartJob.Entry(
                        id = it.optString("id"),
                        name = it.optString("name"),
                        left = it.optString("left"),
                        right = it.optString("right"),
                        disabled = it.optBoolean("disabled"),
                    )
                },
            )
        } catch (e: Exception) {
            Log.w(TAG, "could not read the jobs for the automation picker: ${e.javaClass.simpleName}")
            emptyList()
        }
    }
}
