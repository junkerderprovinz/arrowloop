package design.halleluja.arrowloop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.BatteryManager
import java.net.HttpURLConnection
import java.net.URL

/**
 * What this phone is plugged into, and whether that should stop a timed run.
 *
 * Autosync's two most-used switches are "only while charging" and "only on
 * wifi", and both are questions only Android can answer. The engine has the
 * hook for it - a condition asked before every AUTOMATIC run and never before
 * one somebody pressed a button for - and this is the half that fills it in.
 *
 * IN KOTLIN rather than in JavaScript, and that is the part that makes it work
 * at all. The whole point of both switches is the hours nobody is looking:
 * React Native's context can be torn down while the foreground service carries
 * on, and a watcher that lives in JavaScript would stop reporting at exactly
 * the moment the phone went into a pocket. The preference is kept in
 * SharedPreferences for the same reason - it has to be readable by a broadcast
 * receiver waking up at four in the morning with no interface anywhere.
 *
 * It reports a SENTENCE, not a pair of flags. The engine has no business
 * knowing which of the two conditions applies, only whether one does and what
 * a person should read in the log.
 */
object Device {

    private const val PREFS = "device"
    private const val ONLY_CHARGING = "onlyCharging"
    private const val ONLY_WIFI = "onlyWifi"

    /** The floor, in percent. Zero is off, which is also what a fresh install
     *  gets: a condition nobody asked for must not hold anything. */
    private const val MIN_BATTERY = "minBattery"
    private const val NOT_ROAMING = "notRoaming"
    private const val NOT_METERED = "notMetered"

    /** What was last sent, so an unchanged verdict is not sent again. Android
     *  broadcasts the battery level every few seconds while charging. */
    private var sent: String? = null

    /** What a thread is currently trying to send, so a burst of broadcasts
     *  produces one report rather than one per broadcast. */
    private var inFlight: String? = null

    private var power: BroadcastReceiver? = null
    private var network: ConnectivityManager.NetworkCallback? = null

    fun onlyCharging(context: Context): Boolean = prefs(context).getBoolean(ONLY_CHARGING, false)

    fun onlyWifi(context: Context): Boolean = prefs(context).getBoolean(ONLY_WIFI, false)

    fun minBattery(context: Context): Int = prefs(context).getInt(MIN_BATTERY, 0)

    fun notRoaming(context: Context): Boolean = prefs(context).getBoolean(NOT_ROAMING, false)

    fun notMetered(context: Context): Boolean = prefs(context).getBoolean(NOT_METERED, false)

    /**
     * Store the preferences and tell the engine at once, because somebody who
     * just switched "only on wifi" off expects the next run to go ahead.
     *
     * A map rather than a parameter per switch. It started as two booleans and
     * grew to five settings, and a positional signature at that size is one
     * where a caller swapping two arguments compiles and silently enforces the
     * wrong condition. Anything the map does not mention keeps its stored
     * value, so an older screen cannot wipe a setting it has never heard of.
     */
    fun setPolicy(context: Context, values: Map<String, Any?>) {
        val edit = prefs(context).edit()
        for (key in listOf(ONLY_CHARGING, ONLY_WIFI, NOT_ROAMING, NOT_METERED)) {
            (values[key] as? Boolean)?.let { edit.putBoolean(key, it) }
        }
        (values[MIN_BATTERY] as? Number)?.let {
            // Clamped rather than trusted. A floor above a hundred holds every
            // run for ever on a phone that is behaving perfectly, and the
            // person it happens to has no way to see why.
            edit.putInt(MIN_BATTERY, it.toInt().coerceIn(0, 95))
        }
        edit.apply()
        synchronized(Device) {
            sent = null
            inFlight = null
        }
        report(context)
    }

    /**
     * Whether a cable, a dock or a wireless pad is putting power in.
     *
     * From the STICKY broadcast rather than from BatteryManager.isCharging, and
     * that is not a style preference. isCharging reads the battery HAL
     * directly; the sticky intent is what the framework publishes and what
     * every other app on the phone reads. On an emulator the two disagree
     * outright - `dumpsys battery set ac 1` moves the broadcast and leaves
     * isCharging where it was - and the emulator is where this gets tested, so
     * a check nothing can move is a check nothing can verify.
     *
     * PLUGGED first, because that is the question. A phone at a hundred percent
     * on a charger reports status FULL rather than CHARGING, and treating that
     * as "not charging" would hold every overnight job on exactly the phones
     * that spent the night on the cable.
     */
    fun charging(context: Context): Boolean {
        val now = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (now != null) {
            val plugged = now.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
            if (plugged > 0) return true
            val status = now.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            if (status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
            ) {
                return true
            }
            if (plugged == 0 || status != -1) return false
        }
        // Nothing has published one yet, which happens in the seconds after a
        // boot. Charging is the answer that lets runs through.
        return context.getSystemService(BatteryManager::class.java)?.isCharging ?: true
    }

    /**
     * Whether this phone is on wifi rather than on the mobile network.
     *
     * It used to ask NOT_METERED, which is a question about the BILL: a wifi
     * network its owner marked as metered failed it, and a mobile connection
     * somebody marked unmetered passed. That is defensible and it is not what
     * the switch says. jdp: "nur über kostenfreie verbindung soll einfach Nur
     * über WLAN heißen und es nicht von kosten abhängig machen." A switch
     * reading "only over wifi" that lets a run out over mobile data because the
     * tariff looked generous is a switch that lied, and the person who finds
     * out is the person with the bill.
     *
     * Ethernet counts. A phone in a dock is on a cable, which is wifi's answer
     * to the same question and not the mobile network.
     *
     * No network at all is NOT wifi, so a run waits. That is the opposite of
     * what the old metered test did with the same case, and it is the right way
     * round: with the switch on, "no connection" is not a reason to go ahead.
     */
    fun onWifi(context: Context): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = manager.getNetworkCapabilities(manager.activeNetwork ?: return false)
            ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /**
     * How full the battery is, nought to a hundred, or -1 if nothing has said.
     *
     * From the same sticky broadcast as `charging`, and for the same reason:
     * it is what the framework publishes and what every other app on the phone
     * reads, so a test rig that moves the broadcast moves this too. The level
     * arrives as a fraction of a scale rather than as a percentage, because a
     * device is allowed to count in something other than hundredths.
     */
    fun batteryLevel(context: Context): Int {
        val now = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return -1
        val level = now.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = now.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return -1
        return level * 100 / scale
    }

    /**
     * Whether this phone is on somebody else's network abroad.
     *
     * Android answers this with NOT_ROAMING, a capability added in API 28, and
     * this app runs from 26. On the two versions below it the capability is
     * simply never reported, so asking would read as "roaming" on every phone
     * and hold every run on a device that has never left the country. Unknown
     * therefore means NOT roaming, which is the same direction every other
     * unanswerable question here takes: a condition that blocks when it cannot
     * tell is a condition that stops everything the day something breaks.
     */
    fun roaming(context: Context): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 28) return false
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = manager.getNetworkCapabilities(manager.activeNetwork ?: return false)
            ?: return false
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
    }

    /**
     * Whether this connection is one somebody pays for by the megabyte.
     *
     * A question about the BILL, and deliberately separate from "only on wifi",
     * which is a question about the transport. jdp asked for those two to stop
     * being one switch - *"nur über kostenfreie verbindung soll einfach Nur
     * über WLAN heißen und es nicht von kosten abhängig machen"* - and the
     * answer was to make the wifi switch mean wifi. This is the other half
     * arriving as its own switch: a wifi network whose owner marked it metered
     * is exactly the case the wifi switch cannot catch, and a hotspot shared
     * from a phone is the case that costs real money.
     *
     * No connection at all counts as metered, so a run waits. With the switch
     * on, "no connection" is not a reason to go ahead.
     */
    fun metered(context: Context): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = manager.getNetworkCapabilities(manager.activeNetwork ?: return true)
            ?: return true
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    /**
     * The verdict, in the words that end up in the engine's log. Empty means
     * nothing is in the way.
     *
     * The order is the order somebody would check in: power first, because a
     * flat phone cannot do anything about the network anyway.
     */
    fun reason(context: Context): String {
        if (onlyCharging(context) && !charging(context)) {
            return "this phone is not charging"
        }
        // The floor applies only while NOT charging, and that is the whole of
        // what makes it usable. A phone on the cable at fifteen percent is
        // climbing, and holding its runs would delay exactly the phones that
        // spent the night plugged in - which is the case an overnight schedule
        // is written for.
        val floor = minBattery(context)
        if (floor > 0 && !charging(context)) {
            val level = batteryLevel(context)
            if (level in 0 until floor) {
                return "this phone is below $floor percent"
            }
        }
        if (onlyWifi(context) && !onWifi(context)) {
            return "this phone is not on wifi"
        }
        if (notRoaming(context) && roaming(context)) {
            return "this phone is roaming"
        }
        if (notMetered(context) && metered(context)) {
            return "this connection is metered"
        }
        return ""
    }

    /**
     * Tell the engine, unless it already knows.
     *
     * On its own thread: this is called from a broadcast receiver, and a
     * receiver that makes a network call on the main thread is an app that
     * stops painting while the engine answers.
     */
    @Synchronized
    fun report(context: Context) {
        val now = reason(context)
        if (now == sent || now == inFlight) return
        // Claimed BEFORE the thread starts, and released only if it fails.
        // Android broadcasts the battery several times a second when a cable
        // goes in, and without this each one starts its own connection to say
        // the same thing - four threads racing to report one event.
        inFlight = now
        // Said out loud, because this is a decision taken with no screen
        // anywhere near it. Without the line, "the schedule did not run last
        // night" has no evidence at all on the phone it happened on.
        android.util.Log.i("ArrowLoop", if (now.isEmpty()) "nothing holds automatic runs" else "holding automatic runs: $now")
        val body = """{"reason":${quote(now)}}"""
        Thread {
            try {
                val url = URL("http://${Engine.ADDRESS}/api/device")
                (url.openConnection() as HttpURLConnection).run {
                    requestMethod = "PUT"
                    doOutput = true
                    connectTimeout = 2000
                    readTimeout = 2000
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toByteArray()) }
                    if (responseCode in 200..299) sent = now
                    disconnect()
                }
            } catch (_: Exception) {
                // The engine is not up yet, or is on its way down. Leaving
                // `sent` alone is what makes the next broadcast try again
                // rather than assume it got through.
            } finally {
                synchronized(Device) { if (inFlight == now) inFlight = null }
            }
        }.start()
    }

    /**
     * Start listening, and report once straight away.
     *
     * The immediate report is not a nicety: a phone that has been on the
     * charger since before the service started produces no broadcast, and
     * waiting for one would mean the engine learns nothing until the cable
     * comes out.
     */
    fun watch(context: Context) {
        if (power == null) {
            power = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) = report(context)
            }
            // ACTION_BATTERY_CHANGED is a sticky broadcast that cannot be
            // declared in the manifest, which is exactly why this is registered
            // in code and lives as long as the service.
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_POWER_CONNECTED)
                addAction(Intent.ACTION_POWER_DISCONNECTED)
                addAction(Intent.ACTION_BATTERY_CHANGED)
            }
            context.registerReceiver(power, filter)
        }
        if (network == null) {
            val manager = context.getSystemService(ConnectivityManager::class.java)
            if (manager != null) {
                val callback = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(n: Network) = report(context)
                    override fun onLost(n: Network) = report(context)
                    override fun onCapabilitiesChanged(n: Network, c: NetworkCapabilities) =
                        report(context)
                }
                manager.registerNetworkCallback(NetworkRequest.Builder().build(), callback)
                network = callback
            }
        }
        report(context)
    }

    /** Stop listening. Called when the service goes down, so the receivers do
     *  not outlive the thing they were reporting to. */
    fun forget(context: Context) {
        power?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: IllegalArgumentException) {
                // Already gone. Not worth a crash on the way out.
            }
        }
        power = null
        network?.let {
            try {
                context.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it)
            } catch (_: IllegalArgumentException) {
            }
        }
        network = null
        sent = null
        inFlight = null
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** A JSON string. The reasons are ours and carry nothing exotic, but a
     *  hand-built body that breaks on a quote is a bug waiting for the day
     *  somebody writes one. */
    private fun quote(s: String): String {
        val out = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                else -> out.append(c)
            }
        }
        return out.append('"').toString()
    }
}
